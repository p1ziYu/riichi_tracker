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
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

// Same depth from src/ (tsx) and dist/ (compiled): apps/api/<dir>/migrate.*
const apiRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDir = join(apiRoot, 'migrations');
const infraEnvPath = join(apiRoot, '..', '..', 'infra', '.env');

const MIGRATION_FILE = /^(\d{3})_([a-z0-9_]+)\.sql$/;
// Arbitrary constant; serialises concurrent runners.
const ADVISORY_LOCK_KEY = 0x72696963; // 'riic'

interface Migration {
  version: string;
  name: string;
  file: string;
  sql: string;
  checksum: string;
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

function loadMigrations(): Migration[] {
  const migrations: Migration[] = [];
  const seen = new Set<string>();
  for (const file of readdirSync(migrationsDir).sort()) {
    if (!file.endsWith('.sql')) continue;
    const match = MIGRATION_FILE.exec(file);
    if (!match) throw new Error(`invalid migration file name: ${file} (expected NNN_name.sql)`);
    const [, version, name] = match;
    if (seen.has(version)) throw new Error(`duplicate migration version ${version}`);
    seen.add(version);
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    migrations.push({ version, name, file, sql, checksum });
  }
  return migrations;
}

async function migrate(): Promise<void> {
  const migrations = loadMigrations();
  const client = new pg.Client({ connectionString: resolveDatabaseUrl() });
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

    const { rows } = await client.query<{ version: string; checksum: string }>(
      'SELECT version, checksum FROM public.schema_migrations',
    );
    const applied = new Map(rows.map((r) => [r.version, r.checksum]));
    const known = new Set(migrations.map((m) => m.version));
    for (const version of applied.keys()) {
      if (!known.has(version)) throw new Error(`applied migration ${version} has no file in ${migrationsDir}`);
    }

    let count = 0;
    for (const m of migrations) {
      const appliedChecksum = applied.get(m.version);
      if (appliedChecksum !== undefined) {
        if (appliedChecksum !== m.checksum) {
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

migrate().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
