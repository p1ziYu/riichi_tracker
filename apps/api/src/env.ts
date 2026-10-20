import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = dirname(fileURLToPath(import.meta.url));
const apiRoot = join(currentDir, '..');
const apiEnvPath = join(apiRoot, '.env');
const infraEnvPath = join(apiRoot, '..', '..', 'infra', '.env');

function parseEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
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

export function loadEnv(): void {
  const apiVars = parseEnvFile(apiEnvPath);
  for (const [k, v] of Object.entries(apiVars)) {
    if (!process.env[k] && v) {
      process.env[k] = v;
    }
  }

  const infraVars = parseEnvFile(infraEnvPath);
  if (
    (!process.env.DATABASE_URL || process.env.DATABASE_URL.includes(':@')) &&
    infraVars.POSTGRES_USER &&
    infraVars.POSTGRES_PASSWORD &&
    infraVars.POSTGRES_DB
  ) {
    const host = infraVars.POSTGRES_HOST ?? '127.0.0.1';
    const port = infraVars.POSTGRES_PORT ?? '5432';
    process.env.DATABASE_URL = `postgres://${encodeURIComponent(infraVars.POSTGRES_USER)}:${encodeURIComponent(infraVars.POSTGRES_PASSWORD)}@${host}:${port}/${encodeURIComponent(infraVars.POSTGRES_DB)}`;
  }

  if (!process.env.BETTER_AUTH_SECRET) {
    throw new Error('BETTER_AUTH_SECRET is not set — put it in apps/api/.env (never in source)');
  }
  if (!process.env.PORT) {
    process.env.PORT = '3101';
  }
  if (!process.env.BETTER_AUTH_URL) {
    process.env.BETTER_AUTH_URL = `http://127.0.0.1:${process.env.PORT}`;
  }
}

loadEnv();
