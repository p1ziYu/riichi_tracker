import pg from 'pg';
import './env.js';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  options: '-c search_path=app,public',
});

export async function ensureAuthSchema(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public."user" (
      "id" text NOT NULL PRIMARY KEY,
      "name" text NOT NULL,
      "email" text NOT NULL UNIQUE,
      "emailVerified" boolean NOT NULL DEFAULT false,
      "image" text,
      "createdAt" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
      "updatedAt" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
      "isAnonymous" boolean DEFAULT false
    );
    CREATE TABLE IF NOT EXISTS public."session" (
      "id" text NOT NULL PRIMARY KEY,
      "expiresAt" timestamptz NOT NULL,
      "token" text NOT NULL UNIQUE,
      "createdAt" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
      "updatedAt" timestamptz NOT NULL,
      "ipAddress" text,
      "userAgent" text,
      "userId" text NOT NULL REFERENCES public."user" ("id") ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS "session_userId_idx" ON public."session" ("userId");
    CREATE TABLE IF NOT EXISTS public."account" (
      "id" text NOT NULL PRIMARY KEY,
      "accountId" text NOT NULL,
      "providerId" text NOT NULL,
      "userId" text NOT NULL REFERENCES public."user" ("id") ON DELETE CASCADE,
      "accessToken" text,
      "refreshToken" text,
      "idToken" text,
      "accessTokenExpiresAt" timestamptz,
      "refreshTokenExpiresAt" timestamptz,
      "scope" text,
      "password" text,
      "createdAt" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
      "updatedAt" timestamptz NOT NULL
    );
    CREATE INDEX IF NOT EXISTS "account_userId_idx" ON public."account" ("userId");
    CREATE TABLE IF NOT EXISTS public."verification" (
      "id" text NOT NULL PRIMARY KEY,
      "identifier" text NOT NULL,
      "value" text NOT NULL,
      "expiresAt" timestamptz NOT NULL,
      "createdAt" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
      "updatedAt" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL
    );
    CREATE INDEX IF NOT EXISTS "verification_identifier_idx" ON public."verification" ("identifier");
    CREATE TABLE IF NOT EXISTS public."auth_principal_map" (
      "auth_user_id" text NOT NULL PRIMARY KEY REFERENCES public."user" ("id") ON DELETE CASCADE,
      "principal_id" uuid NOT NULL REFERENCES app.principals ("id") ON DELETE CASCADE,
      "created_at" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL
    );
  `);
}
