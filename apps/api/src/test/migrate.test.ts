import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import { applyMigrations, loadMigrations, type Migration, type MigrationClient } from '../migrate.js';

// Isolated injected client: exercises runner ordering/locking/transactions without any DB URL.
class FakeDatabase {
  readonly versions = new Map<string, string>();
  readonly executedSql: string[] = [];
  nextLock: Promise<void> = Promise.resolve();
}

class FakeClient implements MigrationClient {
  private releaseLock?: () => void;
  private pending?: Map<string, string>;
  private stagedSql: string[] = [];
  constructor(private readonly database: FakeDatabase, private readonly failsOn?: string) {}

  async connect(): Promise<void> {}

  async query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }> {
    if (sql.startsWith('SELECT pg_advisory_lock')) {
      let release!: () => void;
      const current = new Promise<void>((done) => { release = done; });
      const previous = this.database.nextLock;
      this.database.nextLock = current;
      await previous;
      this.releaseLock = release;
    } else if (sql.startsWith('SELECT version, checksum')) {
      return { rows: [...this.database.versions].map(([version, checksum]) => ({ version, checksum })) };
    } else if (sql === 'BEGIN') {
      this.pending = new Map(this.database.versions);
      this.stagedSql = [];
    } else if (sql.startsWith('INSERT INTO public.schema_migrations')) {
      assert.ok(this.pending, 'migration row requires an active transaction');
      this.pending.set(params![0] as string, params![2] as string);
    } else if (sql === 'COMMIT') {
      assert.ok(this.pending, 'commit requires an active transaction');
      this.database.versions.clear();
      for (const [key, value] of this.pending) this.database.versions.set(key, value);
      this.database.executedSql.push(...this.stagedSql);
      this.pending = undefined;
    } else if (sql === 'ROLLBACK') {
      this.pending = undefined;
      this.stagedSql = [];
    } else if (!sql.trimStart().startsWith('CREATE TABLE IF NOT EXISTS')) {
      assert.ok(this.pending, 'migration SQL requires an active transaction');
      this.stagedSql.push(sql);
      if (this.failsOn && sql.includes(this.failsOn)) throw new Error('injected SQL error');
    }
    return { rows: [] };
  }

  async end(): Promise<void> {
    assert.equal(this.pending, undefined, 'transaction must commit or roll back before disconnect');
    this.releaseLock?.();
  }
}

const corrections = (): Migration[] => loadMigrations().filter((m) => m.version === '009' || m.version === '010');

describe('isolated migration runner negative probes', () => {
  it('rejects tampered applied 009 and 010 before executing any SQL', async () => {
    for (const version of ['009', '010']) {
      const migrations = corrections();
      const db = new FakeDatabase();
      await applyMigrations(new FakeClient(db), migrations);
      const sqlCount = db.executedSql.length;
      const altered = migrations.map((m) => m.version === version ? { ...m, checksum: 'tampered' } : m);
      await assert.rejects(applyMigrations(new FakeClient(db), altered), /checksum mismatch/);
      assert.equal(db.executedSql.length, sqlCount);
      assert.deepEqual([...db.versions], migrations.map((m) => [m.version, m.checksum]));
    }
  });

  it('pins corrected 008 content before allowing its historical applied checksum', async () => {
    const migration = loadMigrations().find((m) => m.version === '008')!;
    const historical = '4f1426907db9d02cef674c18ebdee1db1dd8aedfeed9905adae697fd24af25d0';
    for (const appliedChecksum of [historical, migration.checksum]) {
      const db = new FakeDatabase();
      db.versions.set('008', appliedChecksum);
      await applyMigrations(new FakeClient(db), [migration]);
      assert.deepEqual(db.executedSql, []);
    }
    const tamperedSql = `${migration.sql}\n-- tampered after historical 008 applied\n`;
    const tampered = { ...migration, sql: tamperedSql, checksum: createHash('sha256').update(tamperedSql).digest('hex') };
    const db = new FakeDatabase();
    db.versions.set('008', historical);
    await assert.rejects(applyMigrations(new FakeClient(db), [tampered]), /checksum mismatch/);
    assert.deepEqual(db.executedSql, []);
  });

  it('refuses an applied 010 with missing 009 rather than backfilling out of order', async () => {
    const migrations = corrections();
    const db = new FakeDatabase();
    db.versions.set('010', migrations[1].checksum);
    await assert.rejects(applyMigrations(new FakeClient(db), migrations), /missing predecessor/);
    assert.deepEqual(db.executedSql, []);
    assert.deepEqual([...db.versions], [['010', migrations[1].checksum]]);
  });

  it('rolls back a failed 009, including its migration-row insert, before retry', async () => {
    const migrations = corrections();
    const db = new FakeDatabase();
    await assert.rejects(applyMigrations(new FakeClient(db, 'DISABLE TRIGGER tg_ruleset_versions_immutable'), migrations),
      /migration 009_correct_reference_rulesets.sql failed: injected SQL error/);
    assert.deepEqual([...db.versions], []);
    assert.deepEqual(db.executedSql, []);
    await applyMigrations(new FakeClient(db), migrations);
    assert.deepEqual(db.executedSql, migrations.map((m) => m.sql));
  });

  it('rolls back partial 010 and retries only the missing migration; rerun skips recorded versions', async () => {
    const migrations = corrections();
    const db = new FakeDatabase();
    await assert.rejects(applyMigrations(new FakeClient(db, 'ruleset_templates DROP CONSTRAINT'), migrations),
      /migration 010_user_match_rulesets.sql failed: injected SQL error/);
    assert.deepEqual([...db.versions], [['009', migrations[0].checksum]]);
    assert.deepEqual(db.executedSql, [migrations[0].sql]);
    await applyMigrations(new FakeClient(db), migrations);
    assert.deepEqual(db.executedSql, migrations.map((m) => m.sql));
    await applyMigrations(new FakeClient(db), migrations);
    assert.deepEqual(db.executedSql, migrations.map((m) => m.sql));
  });

  it('serializes two concurrent runners so each version executes once', async () => {
    const db = new FakeDatabase();
    const migrations = corrections();
    await Promise.all([
      applyMigrations(new FakeClient(db), migrations),
      applyMigrations(new FakeClient(db), migrations),
    ]);
    assert.deepEqual(db.executedSql, migrations.map((m) => m.sql));
    assert.deepEqual([...db.versions], migrations.map((m) => [m.version, m.checksum]));
  });

  it('applies 012 on top of 011, records ledger, no-op on rerun, and preserves prior checksums', async () => {
    const all = loadMigrations();
    const m012 = all.find((m) => m.version === '012');
    assert.ok(m012, 'migration 012 exists');

    const db = new FakeDatabase();
    for (const m of all) {
      if (m.version === '012') break;
      db.versions.set(m.version, m.version === '008' ? '4f1426907db9d02cef674c18ebdee1db1dd8aedfeed9905adae697fd24af25d0' : m.checksum);
    }
    assert.equal(db.versions.size, 11);
    assert.equal(db.versions.has('012'), false);

    await applyMigrations(new FakeClient(db), all);
    assert.equal(db.versions.size, 12);
    assert.equal(db.versions.get('012'), m012.checksum);
    assert.deepEqual(db.executedSql, [m012.sql]);

    db.executedSql.length = 0;
    await applyMigrations(new FakeClient(db), all);
    assert.deepEqual(db.executedSql, []);
    assert.equal(db.versions.size, 12);
    assert.equal(db.versions.get('008'), '4f1426907db9d02cef674c18ebdee1db1dd8aedfeed9905adae697fd24af25d0');
  });

});
