import { createHash } from 'node:crypto';
import { verifyPassword } from 'better-auth/crypto';
import { betterAuth, type Auth, type BetterAuthOptions } from 'better-auth';
import { bearer } from 'better-auth/plugins';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { pool } from './db.js';

export interface ResolvedPrincipal {
  id: string;
  type: 'account' | 'guest';
  kind: 'user' | 'guest' | 'erased';
  status: 'active' | 'suspended' | 'erased';
  displayName: string;
  createdAt: string;
  authUserId: string;
  sessionId: string;
  sessionToken: string;
}

export async function bindGuestToMatch(
  principalId: string,
  matchId: string,
  db: { query: typeof pool.query },
): Promise<'bound' | 'already_bound_other_match'> {
  // Serialize approvals/check-ins for this guest across different matches.
  // The caller owns a transaction; a principal row SHARE lock cannot serialize
  // two approvals, and a unique verifier only deduplicates the same match.
  await db.query('SELECT pg_advisory_xact_lock(91718, hashtext($1::text))', [principalId]);
  const otherRes = await db.query<{ match_id: string }>(
    `SELECT match_id
     FROM app.guest_sessions
     WHERE principal_id = $1
       AND match_id <> $2
       AND revoked_at IS NULL
       AND expires_at > now()
     LIMIT 1`,
    [principalId, matchId],
  );
  if ((otherRes.rowCount ?? 0) > 0) {
    return 'already_bound_other_match';
  }

  const sessRes = await db.query<{ token: string; expires_at: Date }>(
    `SELECT s."token" AS token, s."expiresAt" AS expires_at
     FROM public.auth_principal_map m
     JOIN public."session" s ON s."userId" = m.auth_user_id
     WHERE m.principal_id = $1
       AND s."expiresAt" > now()
     ORDER BY s."createdAt" DESC
     LIMIT 1`,
    [principalId],
  );
  const sessionSeed = sessRes.rows[0]?.token ?? `${principalId}:${matchId}`;
  const expiresAt = sessRes.rows[0]?.expires_at ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const verifier = createHash('sha256')
    .update(`guest_session:${sessionSeed}:${matchId}`)
    .digest('hex');

  await db.query(
    `INSERT INTO app.guest_sessions (principal_id, match_id, token_verifier, expires_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (token_verifier) DO NOTHING`,
    [principalId, matchId, verifier, expiresAt],
  );
  return 'bound';
}

export async function ensurePrincipalForAuthUser(user: {
  id: string;
  name?: string | null;
  email?: string | null;
}): Promise<{
  id: string;
  kind: 'user' | 'guest' | 'erased';
  status: 'active' | 'suspended' | 'erased';
  display_name: string;
  created_at: Date;
}> {
  const displayName = (user.name?.trim() || user.email?.split('@')[0] || 'Player').slice(0, 64);

  const existing = await pool.query<{
    id: string;
    kind: 'user' | 'guest' | 'erased';
    status: 'active' | 'suspended' | 'erased';
    display_name: string;
    created_at: Date;
  }>(
    `SELECT id, kind, status, display_name, created_at
     FROM app.principals
     WHERE auth_user_id = $1`,
    [user.id],
  );
  if (existing.rows[0]) {
    await pool.query(
      `INSERT INTO public.auth_principal_map (auth_user_id, principal_id)
       VALUES ($1, $2)
       ON CONFLICT (auth_user_id) DO NOTHING`,
      [user.id, existing.rows[0].id],
    );
    return existing.rows[0];
  }

  // A surviving map may still point at a legacy guest principal. Do not
  // replace that identity with a new account or let it join as a user.
  const mapped = await pool.query<{
    id: string;
    kind: 'user' | 'guest' | 'erased';
    status: 'active' | 'suspended' | 'erased';
    display_name: string;
    created_at: Date;
  }>(
    `SELECT p.id, p.kind, p.status, p.display_name, p.created_at
     FROM public.auth_principal_map m
     JOIN app.principals p ON p.id = m.principal_id
     WHERE m.auth_user_id = $1`,
    [user.id],
  );
  if (mapped.rows[0]) return mapped.rows[0];

  const inserted = await pool.query<{
    id: string;
    kind: 'user' | 'guest' | 'erased';
    status: 'active' | 'suspended' | 'erased';
    display_name: string;
    created_at: Date;
  }>(
    `INSERT INTO app.principals (kind, auth_user_id, display_name, status)
     VALUES ('user', $1, $2, 'active')
     ON CONFLICT (auth_user_id) DO UPDATE SET display_name = app.principals.display_name
     RETURNING id, kind, status, display_name, created_at`,
    [user.id, displayName],
  );
  const row = inserted.rows[0];
  await pool.query(
    `INSERT INTO public.auth_principal_map (auth_user_id, principal_id)
     VALUES ($1, $2)
     ON CONFLICT (auth_user_id) DO NOTHING`,
    [user.id, row.id],
  );
  return row;
}

const authOptions = {
  database: pool,
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL ?? `http://127.0.0.1:${process.env.PORT ?? 3101}`,
  trustedOrigins: [
    'https://riichi.p1ziyu.com',
    'http://127.0.0.1:5173',
    'http://localhost:5173',
    'capacitor://localhost',
    'https://localhost',
    ...(process.env.RIICHI_WEB_ORIGIN ? [process.env.RIICHI_WEB_ORIGIN] : []),
  ],
  // Password policy: better-auth 1.7.11 defaults with NO min/max override here.
  // Enforced range is 8–128 chars, no character-kind rules. The web hint
  // (apps/web/src/passwordRules.ts) must stay in sync with these defaults.
  emailAndPassword: {
    enabled: true,
  },
  plugins: [bearer()],
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          await ensurePrincipalForAuthUser(user as { id: string; name?: string; email?: string });
        },
      },
    },
    session: {
      create: {
        after: async (session) => {
          const uRes = await pool.query<{
            id: string;
            name: string;
            email: string;
          }>(`SELECT id, name, email FROM public."user" WHERE id = $1`, [session.userId]);
          if (uRes.rows[0]) {
            await ensurePrincipalForAuthUser(uRes.rows[0]);
          }
        },
      },
    },
  },
} satisfies BetterAuthOptions;

let auth: Auth<typeof authOptions> | undefined;

export function initializeAuth(): Auth<typeof authOptions> {
  return auth ??= betterAuth(authOptions);
}

export function toWebHeaders(req: FastifyRequest): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      for (const v of value) headers.append(key, v);
    } else if (typeof value === 'string') {
      headers.set(key, value);
    }
  }
  // An explicitly supplied bearer credential must never fall back to a different
  // account's cookie if the bearer signature, session or expiry is invalid.
  // The bearer plugin injects its verified token as the session cookie itself.
  if (/^Bearer(?:\s|$)/i.test(headers.get('authorization') ?? '')) {
    headers.delete('cookie');
  }
  return headers;
}

export async function resolvePrincipal(req: FastifyRequest): Promise<ResolvedPrincipal | null> {
  const headers = toWebHeaders(req);
  const session = await initializeAuth().api.getSession({ headers });
  if (!session?.user || !session?.session) {
    return null;
  }

  // Without the anonymous plugin, getSession omits isAnonymous from its user
  // shape. Check the stored flag so sessions issued before the cutover expire
  // without resolving to a principal.
  const authUser = await pool.query<{ is_anonymous: boolean | null }>(
    `SELECT "isAnonymous" AS is_anonymous FROM public."user" WHERE id = $1`,
    [session.user.id],
  );
  if (authUser.rows[0]?.is_anonymous) return null;
  const pRow = await ensurePrincipalForAuthUser(session.user);

  return {
    id: pRow.id,
    type: pRow.kind === 'user' ? 'account' : 'guest',
    kind: pRow.kind,
    status: pRow.status,
    displayName: pRow.display_name,
    createdAt: pRow.created_at instanceof Date ? pRow.created_at.toISOString() : String(pRow.created_at),
    authUserId: session.user.id,
    sessionId: session.session.id,
    sessionToken: session.session.token,
  };
}

function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? 'rj2613haha@gmail.com')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

// Final-native admin gate. Admin is Ryan's own account: identified by the
// linked auth user's email (ADMIN_EMAILS, default rj2613haha@gmail.com) or by
// the known principal id prefix e466d953 (only the prefix was specified, so
// the check is a prefix match). Read dynamically per call so tests can point
// ADMIN_EMAILS at a throwaway account.
export async function isAdminPrincipal(principal: {
  id: string;
  authUserId: string;
}): Promise<boolean> {
  if (principal.id.startsWith('e466d953')) return true;
  const emails = adminEmails();
  const row = (await pool.query<{ email: string | null }>(
    `SELECT email FROM public."user" WHERE id = $1`,
    [principal.authUserId],
  )).rows[0];
  const email = row?.email?.toLowerCase();
  return !!email && emails.includes(email);
}

export async function requirePrincipal(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<ResolvedPrincipal | null> {
  const principal = await resolvePrincipal(req);
  if (!principal) {
    await reply.code(401).send({ error: 'unauthorized', message: 'Authentication required' });
    return null;
  }
  if (principal.status !== 'active') {
    await reply.code(403).send({ error: 'principal_inactive', message: 'Principal is not active' });
    return null;
  }
  return principal;
}

export function registerAuthRoutes(app: FastifyInstance): void {
  const handleAuthRequest = async (req: FastifyRequest, reply: FastifyReply) => {
    const baseUrl = process.env.BETTER_AUTH_URL ?? `http://127.0.0.1:${process.env.PORT ?? 3101}`;
    const url = new URL(req.raw.url || req.url, baseUrl);
    const headers = toWebHeaders(req);
    let body: string | undefined;
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.body !== undefined && req.body !== null) {
      body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    }

    const webReq = new Request(url.toString(), {
      method: req.method,
      headers,
      ...(body !== undefined ? { body } : {}),
    });

    const response = await initializeAuth().handler(webReq);
    reply.status(response.status);

    const setCookies = response.headers.getSetCookie?.() ?? [];
    if (setCookies.length > 0) {
      reply.header('set-cookie', setCookies);
    }
    response.headers.forEach((value, key) => {
      if (key.toLowerCase() === 'set-cookie') return;
      reply.header(key, value);
    });

    const responseText = await response.text();
    if (response.ok && responseText) {
      try {
        const parsed = JSON.parse(responseText) as {
          user?: { id?: string; name?: string; email?: string; isAnonymous?: boolean };
        };
        if (parsed?.user?.id && !parsed.user.isAnonymous) {
          await ensurePrincipalForAuthUser({
            id: parsed.user.id,
            name: parsed.user.name,
            email: parsed.user.email,
          });
        }
      } catch {
        // Non-JSON response body
      }
    }

    return reply.send(responseText);
  };

  app.all('/api/auth/*', handleAuthRequest);

  app.get('/api/me', async (req, reply) => {
    const principal = await resolvePrincipal(req);
    if (!principal) {
      return reply.code(401).send({ error: 'unauthorized', message: 'No active session' });
    }
    if (principal.status !== 'active') {
      return reply.code(403).send({ error: 'principal_inactive', message: 'Principal is not active' });
    }
    return {
      principal: {
        id: principal.id,
        type: principal.type,
        displayName: principal.displayName,
        createdAt: principal.createdAt,
      },
      // Final-native: admin flag for the client admin entry. Unauthenticated
      // callers still get 401 above; this branch never turns that into a 500.
      isAdmin: await isAdminPrincipal(principal),
    };
  });

  // Explicit confirmation and the caller's current credential are required.
  // Keep the principal tombstone and auth-user deletion atomic with the admin guard.
  app.post<{ Body: { currentPassword?: unknown; confirmed?: unknown } }>('/api/me/delete-account', async (req, reply) => {
    const principal = await requirePrincipal(req, reply);
    if (!principal) return;
    if (principal.kind !== 'user') {
      return reply.code(403).send({ error: 'account_required', message: '访客没有可注销的账户' });
    }
    if (req.body?.confirmed !== true) {
      return reply.code(400).send({ error: 'confirmation_required', message: '请确认注销账户' });
    }
    const password = req.body?.currentPassword;
    if (typeof password !== 'string' || !password) {
      return reply.code(400).send({ error: 'current_password_required', message: '请输入当前密码' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Serializes simultaneous self-deletions of administrators.
      await client.query('SELECT pg_advisory_xact_lock(91719, 1)');
      const locked = (await client.query<{ auth_user_id: string | null }>(
        `SELECT auth_user_id FROM app.principals WHERE id = $1 AND kind = 'user' AND status = 'active' FOR UPDATE`,
        [principal.id],
      )).rows[0];
      if (!locked || locked.auth_user_id !== principal.authUserId) {
        await client.query('ROLLBACK');
        return reply.code(403).send({ error: 'account_inactive', message: '账户已不可注销' });
      }
      const credential = (await client.query<{ password: string | null }>(
        `SELECT password FROM public.account WHERE "userId" = $1 AND "providerId" = 'credential'`,
        [principal.authUserId],
      )).rows[0]?.password;
      if (!credential || !(await verifyPassword({ hash: credential, password }))) {
        await client.query('ROLLBACK');
        return reply.code(401).send({ error: 'invalid_current_password', message: '当前密码错误' });
      }
      if (await isAdminPrincipal(principal)) {
        const admins = await client.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM app.principals p
           JOIN public."user" u ON u.id = p.auth_user_id
           WHERE p.kind = 'user' AND p.status = 'active'
             AND (p.id::text LIKE 'e466d953%' OR lower(u.email) = ANY($1::text[]))`,
          [adminEmails()],
        );
        if (Number(admins.rows[0]?.count) <= 1) {
          await client.query('ROLLBACK');
          return reply.code(403).send({
            error: 'sole_admin', message: '不能注销唯一管理员账户，请先指定另一位管理员，以免所有人失去管理权限',
          });
        }
      }
      await client.query(
        `UPDATE app.principals SET kind = 'erased', status = 'erased', auth_user_id = NULL, display_name = '已注销玩家' WHERE id = $1`,
        [principal.id],
      );
      await client.query(`DELETE FROM public."user" WHERE id = $1`, [principal.authUserId]);
      await client.query('COMMIT');
      return { deleted: true };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  });

  // PATCH /api/me/display-name -> rename the caller's principal + auth user name.
  // Returns the same shape as GET /api/me so the web can refresh its state.
  app.patch<{ Body: { displayName?: unknown } }>('/api/me/display-name', async (req, reply) => {
    const principal = await requirePrincipal(req, reply);
    if (!principal) return;
    const raw = req.body?.displayName;
    const displayName = typeof raw === 'string' ? raw.trim() : '';
    if (displayName.length === 0 || displayName.length > 64) {
      return reply.code(400).send({ error: 'invalid_display_name', message: 'Display name must be 1 to 64 characters' });
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE app.principals SET display_name = $1 WHERE id = $2`,
        [displayName, principal.id],
      );
      await client.query(
        `UPDATE public."user" SET name = $1 WHERE id = $2`,
        [displayName, principal.authUserId],
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    return {
      principal: {
        id: principal.id,
        type: principal.type,
        displayName,
        createdAt: principal.createdAt,
      },
      isAdmin: await isAdminPrincipal(principal),
    };
  });
}
