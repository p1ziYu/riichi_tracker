/**
 * SQL migration runner.
 *
 *   pnpm --filter @riichi/api exec tsx src/migrate.ts
 *
 * Applies apps/api/migrations/NNN_name.sql in numeric order, each file in its own
 * transaction together with its public.schema_migrations row. Re-running is a no-op;
 * an already-applied file whose content changed aborts the run (write a new migration
 * instead of editing an old one).
 *
 * Connection: DATABASE_URL from the environment, else from infra/.env (DATABASE_URL,
 * or built from POSTGRES_USER / POSTGRES_PASSWORD / POSTGRES_DB and the compose
 * port mapping 127.0.0.1:5432, overridable with POSTGRES_HOST / POSTGRES_PORT).
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

// Same depth from src/ (tsx) and dist/ (compiled): apps/api/<dir>/migrate.*
const apiRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDir = join(apiRoot, 'migrations');
const infraEnvPath = join(apiRoot, '..', '..', 'infra', '.env');

const MIGRATION_FILE = /^(\d{3})_([a-z0-9_]+)\.sql$/;
// Arbitrary constant; serialises concurrent runners.
const ADVISORY_LOCK_KEY = 0x72696963; // 'riic'

export interface Migration {
  version: string;
  name: string;
  file: string;
  sql: string;
  checksum: string;
}

export interface MigrationClient {
  connect(): Promise<unknown>;
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  end(): Promise<void>;
}

function parseEnvFile(path: string): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim().replace(/^export\s+/, '');
    let value = line.slice(eq + 1).trim();
    if (value.length >= 2 && (value[0] === '"' || value[0] === "'") && value.endsWith(value[0])) {
      value = value.slice(1, -1);
    }
    vars[key] = value;
  }
  return vars;
}

function resolveDatabaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const env = parseEnvFile(infraEnvPath);
  if (env.DATABASE_URL) return env.DATABASE_URL;
  const { POSTGRES_USER: user, POSTGRES_PASSWORD: password, POSTGRES_DB: db } = env;
  if (!user || !password || !db) {
    throw new Error(`DATABASE_URL not set and ${infraEnvPath} lacks DATABASE_URL or POSTGRES_USER/PASSWORD/DB`);
  }
  const host = env.POSTGRES_HOST ?? '127.0.0.1';
  const port = env.POSTGRES_PORT ?? '5432';
  return `postgres://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${encodeURIComponent(db)}`;
}

export function loadMigrations(dir = migrationsDir): Migration[] {
  const migrations: Migration[] = [];
  const seen = new Set<string>();
  for (const file of readdirSync(dir).sort()) {
    if (!file.endsWith('.sql')) continue;
    const match = MIGRATION_FILE.exec(file);
    if (!match) throw new Error(`invalid migration file name: ${file} (expected NNN_name.sql)`);
    const [, version, name] = match;
    if (seen.has(version)) throw new Error(`duplicate migration version ${version}`);
    seen.add(version);
    const sql = readFileSync(join(dir, file), 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    migrations.push({ version, name, file, sql, checksum });
  }
  return migrations;
}

export async function applyMigrations(client: MigrationClient, migrations: readonly Migration[] = loadMigrations()): Promise<void> {
  await client.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [ADVISORY_LOCK_KEY]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.schema_migrations (
        version    text PRIMARY KEY,
        name       text NOT NULL,
        checksum   text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`);

    const { rows } = await client.query('SELECT version, checksum FROM public.schema_migrations');
    const applied = new Map(rows.map((r) => [r.version as string, r.checksum as string]));
    const known = new Set(migrations.map((m) => m.version));
    for (const version of applied.keys()) {
      if (!known.has(version)) throw new Error(`applied migration ${version} has no file in ${migrationsDir}`);
    }
    // A missing predecessor is not a fresh migration: running it after a later
    // version could replay schema changes against the wrong starting state.
    let missingPredecessor = false;
    for (const migration of migrations) {
      if (!applied.has(migration.version)) {
        missingPredecessor = true;
      } else if (missingPredecessor) {
        throw new Error(`applied migration ${migration.version} follows a missing predecessor`);
      }
    }

    let count = 0;
    for (const m of migrations) {
      const appliedChecksum = applied.get(m.version);
      if (appliedChecksum !== undefined) {
        // A historical 008 is allowed only with the known corrected on-disk seed.
        // Do not let a modified current file inherit the historical exemption.
        const originalReferenceSeedChecksum = '4f1426907db9d02cef674c18ebdee1db1dd8aedfeed9905adae697fd24af25d0';
        const correctedReferenceSeedChecksum = 'de141a7c2f409a3204078767c5ca69fc00d0c6cdf59bd8b30460be0ad3f08133';
        if (appliedChecksum !== m.checksum &&
          !(m.version === '008' && appliedChecksum === originalReferenceSeedChecksum &&
            m.checksum === correctedReferenceSeedChecksum)) {
          throw new Error(`migration ${m.file} was modified after being applied (checksum mismatch)`);
        }
        continue;
      }
      await client.query('BEGIN');
      try {
        await client.query(m.sql);
        await client.query(
          'INSERT INTO public.schema_migrations (version, name, checksum) VALUES ($1, $2, $3)',
          [m.version, m.name, m.checksum],
        );
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`migration ${m.file} failed: ${(err as Error).message}`, { cause: err });
      }
      count += 1;
      console.log(`applied ${m.file}`);
    }
    console.log(count === 0 ? 'database is up to date' : `applied ${count} migration(s)`);
  } finally {
    await client.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  Promise.resolve().then(() =>
    applyMigrations(new pg.Client({ connectionString: resolveDatabaseUrl() })),
  ).catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
