// First import must preflight DATABASE_URL before env.js, db.js, or index.js evaluates.
import { assertE2EDatabaseUrl } from './e2e-db-guard.js';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import '../env.js';
import { pool } from '../db.js';
import { buildApp } from '../index.js';

interface Account {
  cookie: string;
  principalId: string;
  authUserId: string;
  email: string;
  password: string;
}

interface MatchView {
  id: string;
  mode: string;
  status: string;
  hostId: string;
  joinCode: string;
  members: { userId: string; displayName: string; isHost: boolean }[];
  seats: { seatNo: number; userId: string; wind: string }[];
  finalScores: { wind: string; score: number; rank: number }[] | null;
}

test('Account self-service + admin soft-delete', async () => {
  assertE2EDatabaseUrl();
  const app = await buildApp();
  try {
    const baseUrl = (await app.listen({ port: 0, host: '127.0.0.1' })).replace('[::1]', '127.0.0.1');
    const request = async <T>(path: string, options: { method?: string; cookie?: string; body?: unknown } = {}) => {
      const response = await fetch(`${baseUrl}${path}`, {
        method: options.method ?? 'GET',
        headers: {
          origin: 'http://127.0.0.1:5173',
          ...(options.cookie ? { cookie: options.cookie } : {}),
          ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });
      return { status: response.status, data: (await response.json()) as T };
    };
    const runId = randomUUID().slice(0, 8);
    let playerNumber = 0;
    const signup = async (name: string, password: string, emailOverride?: string): Promise<Account> => {
      const email = emailOverride ?? `acct_${runId}_${playerNumber++}@example.com`;
      const signup = await fetch(`${baseUrl}/api/auth/sign-up/email`, {
        method: 'POST',
        headers: { origin: 'http://127.0.0.1:5173', 'content-type': 'application/json' },
        body: JSON.stringify({ email, name, password }),
      });
      assert.equal(signup.status, 200, `Sign-up for ${email}`);
      const cookie = (signup.headers.getSetCookie?.() ?? []).map((v) => v.split(';')[0]).join('; ');
      assert.ok(cookie, `Session cookie for ${email}`);
      const me = await request<{ principal: { id: string } }>('/api/me', { cookie });
      assert.equal(me.status, 200);
      const pRow = await pool.query<{ auth_user_id: string }>(
        `SELECT auth_user_id FROM app.principals WHERE id = $1`,
        [me.data.principal.id],
      );
      return {
        cookie,
        principalId: me.data.principal.id,
        authUserId: pRow.rows[0]?.auth_user_id ?? '',
        email,
        password,
      };
    };

    // ---- Rename (PATCH /api/me/display-name) ----
    const user = await signup('原名', 'Password123');
    const renamed = await request<{ principal: { displayName: string } }>('/api/me/display-name', {
      method: 'PATCH', cookie: user.cookie, body: { displayName: '  新名字  ' },
    });
    assert.equal(renamed.status, 200);
    assert.equal(renamed.data.principal.displayName, '新名字', 'display name is trimmed');
    const pAfter = await pool.query<{ display_name: string }>(
      `SELECT display_name FROM app.principals WHERE id = $1`, [user.principalId],
    );
    assert.equal(pAfter.rows[0].display_name, '新名字', 'principal row updated');
    const uAfter = await pool.query<{ name: string }>(
      `SELECT name FROM public."user" WHERE id = $1`, [user.authUserId],
    );
    assert.equal(uAfter.rows[0].name, '新名字', 'auth user row updated');

    const empty = await request<{ error: string }>('/api/me/display-name', {
      method: 'PATCH', cookie: user.cookie, body: { displayName: '   ' },
    });
    assert.equal(empty.status, 400);
    assert.equal(empty.data.error, 'invalid_display_name');
    const tooLong = await request<{ error: string }>('/api/me/display-name', {
      method: 'PATCH', cookie: user.cookie, body: { displayName: '名'.repeat(65) },
    });
    assert.equal(tooLong.status, 400);
    assert.equal(tooLong.data.error, 'invalid_display_name');
    const anonRename = await request<{ error: string }>('/api/me/display-name', {
      method: 'PATCH', body: { displayName: 'x' },
    });
    assert.equal(anonRename.status, 401);

    // ---- Change password (built-in endpoint) ----
    const wrongCurrent = await request<{ code: string }>('/api/auth/change-password', {
      method: 'POST', cookie: user.cookie,
      body: { currentPassword: 'WrongCurrent', newPassword: 'NewPassword456' },
    });
    assert.equal(wrongCurrent.status, 400);
    assert.equal(wrongCurrent.data.code, 'INVALID_PASSWORD');
    const shortNew = await request<{ code: string }>('/api/auth/change-password', {
      method: 'POST', cookie: user.cookie,
      body: { currentPassword: 'Password123', newPassword: 'abcdefg' },
    });
    assert.equal(shortNew.status, 400);
    assert.equal(shortNew.data.code, 'PASSWORD_TOO_SHORT');
    const changed = await request('/api/auth/change-password', {
      method: 'POST', cookie: user.cookie,
      body: { currentPassword: 'Password123', newPassword: 'NewPassword456' },
    });
    assert.equal(changed.status, 200);
    const relogin = await fetch(`${baseUrl}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: { origin: 'http://127.0.0.1:5173', 'content-type': 'application/json' },
      body: JSON.stringify({ email: user.email, password: 'NewPassword456' }),
    });
    assert.equal(relogin.status, 200, 'new password signs in');

    // ---- Admin soft-delete a non-admin who shares a finished match ----
    const victim = await signup('受害者', 'VictimPass123');
    const other = await signup('另一位', 'OtherPass123');
    const filler2 = await signup('填充二', 'FillerPass123');
    const filler3 = await signup('填充三', 'FillerPass123');

    const create = await request<{ match: MatchView }>('/api/matches', {
      method: 'POST', cookie: victim.cookie, body: { mode: '4p' },
    });
    assert.equal(create.status, 200);
    const match = create.data.match;
    for (const p of [other, filler2, filler3]) {
      const joined = await request<MatchView>(`/api/matches/${match.id}/join`, {
        method: 'POST', cookie: p.cookie, body: { code: match.joinCode },
      });
      assert.equal(joined.status, 200);
    }
    const finished = await request<MatchView>(`/api/matches/${match.id}/final-scores`, {
      method: 'POST', cookie: victim.cookie,
      body: { scores: [{ wind: 'E', score: 300 }, { wind: 'S', score: 300 }, { wind: 'W', score: 250 }, { wind: 'N', score: 150 }] },
    });
    assert.equal(finished.status, 200);
    assert.equal(finished.data.status, 'finished');
    const beforeDetail = await request<MatchView>(`/api/matches/${match.id}`, { cookie: other.cookie });
    assert.equal(beforeDetail.status, 200);
    const beforeScores = JSON.stringify(beforeDetail.data.finalScores);

    const adminEmail = `acct_admin_${runId}@example.com`;
    process.env.ADMIN_EMAILS = adminEmail;
    const admin = await signup('管理员', 'AdminPass123', adminEmail);
    const meAdmin = await request<{ isAdmin: boolean }>('/api/me', { cookie: admin.cookie });
    assert.equal(meAdmin.data.isAdmin, true);

    // 1. Admin deletes the non-admin: 200 { deleted: true }.
    const deleted = await request<{ deleted: boolean }>(`/api/admin/players/${victim.principalId}`, {
      method: 'DELETE', cookie: admin.cookie,
    });
    assert.equal(deleted.status, 200);
    assert.equal(deleted.data.deleted, true);

    // 2. Deleted user's old session now 401.
    const oldSession = await request<{ error: string }>('/api/me', { cookie: victim.cookie });
    assert.equal(oldSession.status, 401);

    // 3. Sign-in with deleted email + old password fails.
    const signin = await fetch(`${baseUrl}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: { origin: 'http://127.0.0.1:5173', 'content-type': 'application/json' },
      body: JSON.stringify({ email: victim.email, password: 'VictimPass123' }),
    });
    assert.equal(signin.status, 401);
    const signinBody = (await signin.json()) as { code: string };
    assert.equal(signinBody.code, 'INVALID_EMAIL_OR_PASSWORD');

    // 4. Admin players list no longer contains the deleted principal id.
    const players = await request<{ players: { id: string }[] }>('/api/admin/players', { cookie: admin.cookie });
    assert.equal(players.status, 200);
    assert.equal(players.data.players.some((p) => p.id === victim.principalId), false);

    // 5. Match survives: finished, finalScores unchanged, victim renders as 已注销玩家.
    const afterDetail = await request<MatchView>(`/api/matches/${match.id}`, { cookie: other.cookie });
    assert.equal(afterDetail.status, 200);
    assert.equal(afterDetail.data.status, 'finished');
    assert.equal(JSON.stringify(afterDetail.data.finalScores), beforeScores, 'finalScores unchanged');
    const victimMember = afterDetail.data.members.find((m) => m.userId === victim.principalId);
    assert.ok(victimMember, 'victim member row still present');
    assert.equal(victimMember.displayName, '已注销玩家');

    // 6. Admin cannot delete their own principal id: 403 cannot_delete_self.
    const selfDelete = await request<{ error: string }>(`/api/admin/players/${admin.principalId}`, {
      method: 'DELETE', cookie: admin.cookie,
    });
    assert.equal(selfDelete.status, 403);
    assert.equal(selfDelete.data.error, 'cannot_delete_self');

    // 7. Admin deleting an already-deleted / nonexistent id: 404 player_not_found.
    const alreadyDeleted = await request<{ error: string }>(`/api/admin/players/${victim.principalId}`, {
      method: 'DELETE', cookie: admin.cookie,
    });
    assert.equal(alreadyDeleted.status, 404);
    assert.equal(alreadyDeleted.data.error, 'player_not_found');
    const nonexistent = await request<{ error: string }>(`/api/admin/players/${randomUUID()}`, {
      method: 'DELETE', cookie: admin.cookie,
    });
    assert.equal(nonexistent.status, 404);
    assert.equal(nonexistent.data.error, 'player_not_found');

    delete process.env.ADMIN_EMAILS;
  } finally {
    await app.close();
    await pool.end();
  }
});
