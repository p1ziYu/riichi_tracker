import { createHash } from 'node:crypto';
import { betterAuth } from 'better-auth';
import { anonymous, bearer } from 'better-auth/plugins';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { pool } from './db.js';

export interface ResolvedPrincipal {
  id: string;
  type: 'account' | 'guest';
  kind: 'user' | 'guest';
  displayName: string;
  createdAt: string;
  authUserId: string;
  sessionId: string;
  sessionToken: string;
}

export async function ensureGuestSessionForPrincipal(
  principalId: string,
  authUserId: string,
  matchId?: string,
): Promise<void> {
  let targetMatchId = matchId;
  if (!targetMatchId) {
    const mRes = await pool.query<{ id: string }>(
      `SELECT id FROM app.matches ORDER BY created_at DESC LIMIT 1`,
    );
    targetMatchId = mRes.rows[0]?.id;
  }
  if (!targetMatchId) {
    return;
  }

  const verifier = createHash('sha256').update(`guest_device:${authUserId}:${targetMatchId}`).digest('hex');
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await pool.query(
    `INSERT INTO app.guest_sessions (principal_id, match_id, token_verifier, expires_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (token_verifier) DO NOTHING`,
    [principalId, targetMatchId, verifier, expiresAt],
  );
}

export async function bindAllUnboundGuestsToMatch(matchId: string): Promise<void> {
  const res = await pool.query<{ auth_user_id: string; principal_id: string }>(
    `SELECT m.auth_user_id, m.principal_id
     FROM public.auth_principal_map m
     JOIN app.principals p ON p.id = m.principal_id
     WHERE p.kind = 'guest'
       AND NOT EXISTS (
         SELECT 1 FROM app.guest_sessions gs
         WHERE gs.principal_id = m.principal_id AND gs.revoked_at IS NULL
       )`,
  );
  for (const row of res.rows) {
    await ensureGuestSessionForPrincipal(row.principal_id, row.auth_user_id, matchId);
  }
}

export async function ensurePrincipalForAuthUser(user: {
  id: string;
  name?: string | null;
  email?: string | null;
  isAnonymous?: boolean | null;
}): Promise<{
  id: string;
  kind: 'user' | 'guest';
  display_name: string;
  created_at: Date;
}> {
  const isAnon = Boolean(user.isAnonymous);
  const displayName = (user.name?.trim() || (isAnon ? 'Guest' : user.email?.split('@')[0]) || 'Player').slice(0, 64);

  if (!isAnon) {
    const existing = await pool.query<{
      id: string;
      kind: 'user' | 'guest';
      display_name: string;
      created_at: Date;
    }>(
      `SELECT id, kind, display_name, created_at
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

    const inserted = await pool.query<{
      id: string;
      kind: 'user' | 'guest';
      display_name: string;
      created_at: Date;
    }>(
      `INSERT INTO app.principals (kind, auth_user_id, display_name, status)
       VALUES ('user', $1, $2, 'active')
       ON CONFLICT (auth_user_id) DO UPDATE SET display_name = app.principals.display_name
       RETURNING id, kind, display_name, created_at`,
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

  // Anonymous guest principal: app.principals.ck_principals_auth_user requires auth_user_id IS NULL for kind='guest'.
  const mapped = await pool.query<{
    id: string;
    kind: 'user' | 'guest';
    display_name: string;
    created_at: Date;
  }>(
    `SELECT p.id, p.kind, p.display_name, p.created_at
     FROM public.auth_principal_map m
     JOIN app.principals p ON p.id = m.principal_id
     WHERE m.auth_user_id = $1`,
    [user.id],
  );
  if (mapped.rows[0]) {
    await ensureGuestSessionForPrincipal(mapped.rows[0].id, user.id);
    return mapped.rows[0];
  }

  const inserted = await pool.query<{
    id: string;
    kind: 'user' | 'guest';
    display_name: string;
    created_at: Date;
  }>(
    `INSERT INTO app.principals (kind, auth_user_id, display_name, status)
     VALUES ('guest', NULL, $1, 'active')
     RETURNING id, kind, display_name, created_at`,
    [displayName],
  );
  const row = inserted.rows[0];
  await pool.query(
    `INSERT INTO public.auth_principal_map (auth_user_id, principal_id)
     VALUES ($1, $2)
     ON CONFLICT (auth_user_id) DO NOTHING`,
    [user.id, row.id],
  );
  await ensureGuestSessionForPrincipal(row.id, user.id);
  return row;
}

export const auth = betterAuth({
  database: pool,
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL ?? `http://127.0.0.1:${process.env.PORT ?? 3101}`,
  trustedOrigins: ['http://127.0.0.1:*', 'http://localhost:*'],
  advanced: {
    disableCSRFCheck: true,
  },
  emailAndPassword: {
    enabled: true,
  },
  plugins: [
    anonymous({
      onLinkAccount: async ({ anonymousUser, newUser }) => {
        const guestPrincipal = await ensurePrincipalForAuthUser({
          ...anonymousUser.user,
          isAnonymous: true,
        });
        const accountPrincipal = await ensurePrincipalForAuthUser({
          ...newUser.user,
          isAnonymous: false,
        });
        if (guestPrincipal.id !== accountPrincipal.id) {
          await pool.query(
            `INSERT INTO app.principal_links (source_principal_id, target_principal_id)
             VALUES ($1, $2)
             ON CONFLICT (source_principal_id) DO NOTHING`,
            [guestPrincipal.id, accountPrincipal.id],
          );
        }
      },
    }),
    bearer(),
  ],
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          await ensurePrincipalForAuthUser(user as { id: string; name?: string; email?: string; isAnonymous?: boolean });
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
            isAnonymous: boolean | null;
          }>(`SELECT id, name, email, "isAnonymous" FROM public."user" WHERE id = $1`, [session.userId]);
          if (uRes.rows[0]) {
            await ensurePrincipalForAuthUser(uRes.rows[0]);
          }
        },
      },
    },
  },
});

export function toWebHeaders(req: FastifyRequest): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      for (const v of value) headers.append(key, v);
    } else if (typeof value === 'string') {
      headers.set(key, value);
    }
  }
  return headers;
}

export async function resolvePrincipal(req: FastifyRequest): Promise<ResolvedPrincipal | null> {
  const headers = toWebHeaders(req);
  const session = await auth.api.getSession({ headers });
  if (!session?.user || !session?.session) {
    return null;
  }

  const pRow = await ensurePrincipalForAuthUser(
    session.user as { id: string; name?: string; email?: string; isAnonymous?: boolean },
  );

  return {
    id: pRow.id,
    type: pRow.kind === 'user' ? 'account' : 'guest',
    kind: pRow.kind,
    displayName: pRow.display_name,
    createdAt: pRow.created_at instanceof Date ? pRow.created_at.toISOString() : String(pRow.created_at),
    authUserId: session.user.id,
    sessionId: session.session.id,
    sessionToken: session.session.token,
  };
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

    const response = await auth.handler(webReq);
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
        if (parsed?.user?.id) {
          await ensurePrincipalForAuthUser({
            id: parsed.user.id,
            name: parsed.user.name,
            email: parsed.user.email,
            isAnonymous: parsed.user.isAnonymous ?? url.pathname.endsWith('/anonymous'),
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
    return {
      principal: {
        id: principal.id,
        type: principal.type,
        displayName: principal.displayName,
        createdAt: principal.createdAt,
      },
    };
  });
}
