import { existsSync, readFileSync } from 'node:fs';

// Stage B E2E writes data and creates schema objects. Set DATABASE_URL explicitly to a
// disposable database (name containing test, e2e, disp, or tmp) before running it.
// apps/api/.env and infra/.env are NOT acceptable E2E defaults; the API's configured
// database name is forbidden even if it happens to contain one of those markers.
const apiEnvPath = new URL('../../.env', import.meta.url);

function databaseName(connectionString: string): string {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL URL');
  }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new Error('DATABASE_URL must use postgres:// or postgresql://');
  }
  // pg's connection-string parser can override the path's database with a query parameter.
  if ([...url.searchParams.keys()].some((key) => key.toLowerCase() === 'database' || key.toLowerCase() === 'dbname')) {
    throw new Error('DATABASE_URL must not override the database name in query parameters');
  }
  let name: string;
  try {
    name = decodeURIComponent(url.pathname.slice(1));
  } catch {
    throw new Error('DATABASE_URL contains an invalid database name');
  }
  if (!/^[a-z0-9_.-]+$/i.test(name)) {
    throw new Error('DATABASE_URL must name one plain database in its path');
  }
  return name;
}

function configuredDatabaseName(): string | undefined {
  if (!existsSync(apiEnvPath)) return undefined;
  let configuredUrl: string | undefined;
  for (const raw of readFileSync(apiEnvPath, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0 || line.slice(0, eq).trim().replace(/^export\s+/, '') !== 'DATABASE_URL') continue;
    let value = line.slice(eq + 1).trim();
    if (value.length >= 2 && (value[0] === '"' || value[0] === "'") && value.endsWith(value[0])) {
      value = value.slice(1, -1);
    }
    configuredUrl = value;
  }
  return configuredUrl ? databaseName(configuredUrl) : undefined;
}

export function assertE2EDatabaseUrl(): void {
  try {
    // Check process.env before importing env.js: it otherwise fills DATABASE_URL from
    // apps/api/.env or infra/.env (and can replace URLs containing ':@').
    const explicitUrl = process.env.DATABASE_URL;
    if (!explicitUrl || explicitUrl.includes(':@')) {
      throw new Error('set DATABASE_URL explicitly to a disposable test database URL');
    }
    const name = databaseName(explicitUrl);
    if (!/(test|e2e|disp|tmp)/i.test(name)) {
      throw new Error('DATABASE_URL database name must contain test, e2e, disp, or tmp');
    }
    if (name.toLowerCase() === 'riichi' || name.toLowerCase() === configuredDatabaseName()?.toLowerCase()) {
      throw new Error('DATABASE_URL targets the production/configured API database');
    }
  } catch (error) {
    throw new Error(`Stage B E2E database guard refused to run: ${(error as Error).message}`);
  }
}

// ESM evaluates this first import before db.js/index.js/env.js, so an unsafe URL
// cannot even construct a pool or register the destructive node:test suite.
assertE2EDatabaseUrl();
