// First import must preflight DATABASE_URL before env.js, db.js, or index.js evaluates.
import { assertE2EDatabaseUrl } from './e2e-db-guard.js';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import '../env.js';
import { pool } from '../db.js';
import { buildApp } from '../index.js';

interface Player {
  cookie: string;
  principalId: string;
  displayName: string;
  email: string;
}

interface MatchView {
  id: string;
  mode: string;
  status: string;
  hostId: string;
  joinCode: string;
  inviteCode?: string;
  joinToken?: string;
  members: { userId: string; displayName: string; isHost: boolean }[];
  seats: { seatNo: number; userId: string; wind: string }[];
  finalScores: { wind: string; score: number; rank: number }[] | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  correctedAt: string | null;
}

test('Final-native model: create, auto-draw join, final scores, cancel, admin, retired routes', async () => {
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
      return { status: response.status, data: await response.json() as T, retryAfter: response.headers.get('retry-after') };
    };
    const runId = randomUUID().slice(0, 8);
    let playerNumber = 0;
    const player = async (name: string, emailOverride?: string): Promise<Player> => {
      const email = emailOverride ?? `final_${runId}_${playerNumber++}@example.com`;
      const signup = await fetch(`${baseUrl}/api/auth/sign-up/email`, {
        method: 'POST',
        headers: { origin: 'http://127.0.0.1:5173', 'content-type': 'application/json' },
        body: JSON.stringify({ email, name, password: 'Password123!StrongEnough' }),
      });
      assert.equal(signup.status, 200, `Sign-up for ${email}`);
      const cookie = (signup.headers.getSetCookie?.() ?? []).map((v) => v.split(';')[0]).join('; ');
      assert.ok(cookie, `Session cookie for ${email}`);
      const me = await request<{ principal: { id: string; displayName: string } }>('/api/me', { cookie });
      assert.equal(me.status, 200);
      return { cookie, principalId: me.data.principal.id, displayName: me.data.principal.displayName, email };
    };
    const create = async (owner: Player, mode: string) => {
      const res = await request<{ match: MatchView }>('/api/matches', {
        method: 'POST', cookie: owner.cookie, body: { mode },
      });
      return res;
    };
    const join = async (id: string, p: Player, body: Record<string, unknown>) =>
      request<MatchView>(`/api/matches/${id}/join`, { method: 'POST', cookie: p.cookie, body });
    const mine = async (p: Player) => request<MatchView[]>('/api/matches/mine', { cookie: p.cookie });

    // /api/me: unauthenticated stays 401; authenticated non-admin isAdmin false.
    const anonMe = await request<{ error: string }>('/api/me');
    assert.equal(anonMe.status, 401);
    assert.equal(anonMe.data.error, 'unauthorized');

    const [owner, second, third, fourth, outsider] = await Promise.all([
      player('Final owner'), player('Final second'), player('Final third'),
      player('Final fourth'), player('Final outsider'),
    ]);
    const meOwner = await request<{ principal: { id: string }; isAdmin: boolean }>('/api/me', { cookie: owner.cookie });
    assert.equal(meOwner.status, 200);
    assert.equal(meOwner.data.isAdmin, false);

    // Create: invalid mode rejected; 4p starts waiting with a 6-char code.
    const badMode = await create(owner, '5p');
    assert.equal(badMode.status, 400);
    const created = await create(owner, '4p');
    assert.equal(created.status, 200);
    const match = created.data.match;
    assert.equal(match.mode, '4p');
    assert.equal(match.status, 'waiting');
    assert.match(match.joinCode, /^[A-HJ-NP-Z2-9]{6}$/);
    assert.deepEqual(match.seats, []);
    assert.equal(match.finalScores, null);
    assert.equal(match.members.length, 1);
    assert.equal(match.members[0].userId, owner.principalId);
    assert.ok(match.joinToken, 'creation returns a share-page join token');

    // Join: wrong code rejected; partial joins stay waiting; repeat join idempotent.
    const wrongCode = await join(match.id, second, { code: 'ZZZZZZ' });
    assert.equal(wrongCode.status, 400);
    const j2 = await join(match.id, second, { code: match.joinCode });
    assert.equal(j2.status, 200);
    assert.equal(j2.data.status, 'waiting');
    const j2again = await join(match.id, second, { code: match.joinCode });
    assert.equal(j2again.status, 200);
    assert.equal(j2again.data.members.length, 2, 'repeat join does not duplicate the member');
    const j3 = await join(match.id, third, { code: match.joinCode });
    assert.equal(j3.status, 200);
    assert.equal(j3.data.status, 'waiting');

    // Join by deep-link token (from by-code) fills the room: auto-draw + in_progress.
    const byCode = await request<{ matchId: string; token: string }>(`/api/matches/by-code/${match.joinCode}`, { cookie: fourth.cookie });
    assert.equal(byCode.status, 200);
    assert.equal(byCode.data.matchId, match.id);
    const j4 = await join(match.id, fourth, { token: byCode.data.token });
    assert.equal(j4.status, 200);
    assert.equal(j4.data.status, 'in_progress');
    assert.equal(j4.data.members.length, 4);
    assert.deepEqual(
      [...j4.data.seats].sort((a, b) => a.seatNo - b.seatNo).map((s) => s.wind),
      ['E', 'S', 'W', 'N'],
      'auto-draw assigns every wind exactly once, seat 0 is East (dealer)',
    );
    assert.deepEqual(
      new Set(j4.data.seats.map((s) => s.userId)),
      new Set([owner, second, third, fourth].map((p) => p.principalId)),
    );

    // Full room refuses a fifth player; mine only shows the caller's matches.
    const full = await join(match.id, outsider, { code: match.joinCode });
    assert.equal(full.status, 409);
    const outsiderMine = await mine(outsider);
    assert.equal(outsiderMine.status, 200);
    assert.deepEqual(outsiderMine.data, [], 'outsider sees none of this match');
    const secondMine = await mine(second);
    assert.equal(secondMine.data.some((m) => m.id === match.id && m.status === 'in_progress'), true);

    // Final scores: host-only, sum/range/integer/seat validation, wind tie-break ranks.
    const nonHost = await request<MatchView>(`/api/matches/${match.id}/final-scores`, {
      method: 'POST', cookie: second.cookie,
      body: { scores: [{ wind: 'E', score: 250 }, { wind: 'S', score: 250 }, { wind: 'W', score: 250 }, { wind: 'N', score: 250 }] },
    });
    assert.equal(nonHost.status, 403);
    const badSum = await request<{ error: string }>(`/api/matches/${match.id}/final-scores`, {
      method: 'POST', cookie: owner.cookie,
      body: { scores: [{ wind: 'E', score: 300 }, { wind: 'S', score: 300 }, { wind: 'W', score: 300 }, { wind: 'N', score: 300 }] },
    });
    assert.equal(badSum.status, 400);
    assert.equal(badSum.data.error, 'total_mismatch');
    const badRange = await request<{ error: string }>(`/api/matches/${match.id}/final-scores`, {
      method: 'POST', cookie: owner.cookie,
      body: { scores: [{ wind: 'E', score: 20000 }, { wind: 'S', score: 0 }, { wind: 'W', score: 0 }, { wind: 'N', score: -19000 }] },
    });
    assert.equal(badRange.status, 400);
    assert.equal(badRange.data.error, 'score_out_of_range');
    const badInt = await request<{ error: string }>(`/api/matches/${match.id}/final-scores`, {
      method: 'POST', cookie: owner.cookie,
      body: { scores: [{ wind: 'E', score: 250.5 }, { wind: 'S', score: 250 }, { wind: 'W', score: 250 }, { wind: 'N', score: 249.5 }] },
    });
    assert.equal(badInt.status, 400);
    const incomplete = await request<{ error: string }>(`/api/matches/${match.id}/final-scores`, {
      method: 'POST', cookie: owner.cookie,
      body: { scores: [{ wind: 'E', score: 400 }, { wind: 'S', score: 300 }, { wind: 'W', score: 300 }] },
    });
    assert.equal(incomplete.status, 400);
    const finished = await request<MatchView>(`/api/matches/${match.id}/final-scores`, {
      method: 'POST', cookie: owner.cookie,
      body: { scores: [{ wind: 'E', score: 300 }, { wind: 'S', score: 300 }, { wind: 'W', score: 250 }, { wind: 'N', score: 150 }] },
    });
    assert.equal(finished.status, 200);
    assert.equal(finished.data.status, 'finished');
    assert.ok(finished.data.finishedAt, 'finishedAt is set');
    assert.deepEqual(
      finished.data.finalScores?.map((s) => `${s.wind}:${s.score}:${s.rank}`),
      ['E:300:1', 'S:300:2', 'W:250:3', 'N:150:4'],
      'ties break by wind order E > S > W > N',
    );

    // Correction: host-only, finished-only, seats locked, correctedAt set.
    const patchNonHost = await request<MatchView>(`/api/matches/${match.id}/final-scores`, {
      method: 'PATCH', cookie: second.cookie,
      body: { scores: [{ wind: 'E', score: 350 }, { wind: 'S', score: 250 }, { wind: 'W', score: 250 }, { wind: 'N', score: 150 }] },
    });
    assert.equal(patchNonHost.status, 403);
    const corrected = await request<MatchView>(`/api/matches/${match.id}/final-scores`, {
      method: 'PATCH', cookie: owner.cookie,
      body: { scores: [{ wind: 'E', score: 350 }, { wind: 'S', score: 250 }, { wind: 'W', score: 250 }, { wind: 'N', score: 150 }] },
    });
    assert.equal(corrected.status, 200);
    assert.equal(corrected.data.status, 'finished');
    assert.ok(corrected.data.correctedAt, 'correctedAt is set on correction');
    assert.deepEqual(
      corrected.data.finalScores?.map((s) => `${s.wind}:${s.score}:${s.rank}`),
      ['E:350:1', 'S:250:2', 'W:250:3', 'N:150:4'],
    );

    // Cancel: host-only, waiting -> cancelled, finished cannot be cancelled.
    const waitCreated = await create(owner, '4p');
    assert.equal(waitCreated.status, 200);
    const waitMatch = waitCreated.data.match;
    const cancelNonHost = await request<MatchView>(`/api/matches/${waitMatch.id}/cancel`, { method: 'POST', cookie: second.cookie, body: {} });
    assert.equal(cancelNonHost.status, 403);
    const cancelled = await request<MatchView>(`/api/matches/${waitMatch.id}/cancel`, { method: 'POST', cookie: owner.cookie, body: {} });
    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.data.status, 'cancelled');
    const cancelFinished = await request<{ error: string }>(`/api/matches/${match.id}/cancel`, { method: 'POST', cookie: owner.cookie, body: {} });
    assert.equal(cancelFinished.status, 409);
    const joinCancelled = await join(waitMatch.id, outsider, { code: waitMatch.joinCode });
    assert.equal(joinCancelled.status, 409);

    // 3p: total is 1050, not 1000.
    const created3 = await create(owner, '3p');
    assert.equal(created3.status, 200);
    const m3 = created3.data.match;
    assert.equal(m3.mode, '3p');
    await join(m3.id, second, { code: m3.joinCode });
    const j3last = await join(m3.id, third, { code: m3.joinCode });
    assert.equal(j3last.data.status, 'in_progress');
    assert.deepEqual(
      [...j3last.data.seats].sort((a, b) => a.seatNo - b.seatNo).map((s) => s.wind),
      ['E', 'S', 'W'],
    );
    const wrong3Total = await request<{ error: string }>(`/api/matches/${m3.id}/final-scores`, {
      method: 'POST', cookie: owner.cookie,
      body: { scores: [{ wind: 'E', score: 400 }, { wind: 'S', score: 300 }, { wind: 'W', score: 300 }] },
    });
    assert.equal(wrong3Total.status, 400);
    assert.equal(wrong3Total.data.error, 'total_mismatch');
    const finished3 = await request<MatchView>(`/api/matches/${m3.id}/final-scores`, {
      method: 'POST', cookie: owner.cookie,
      body: { scores: [{ wind: 'E', score: 450 }, { wind: 'S', score: 350 }, { wind: 'W', score: 250 }] },
    });
    assert.equal(finished3.status, 200);
    assert.equal(finished3.data.status, 'finished');

    // Retired surfaces return 410 (templates, draw, hands, check-in, join-requests,
    // template-selected creation).
    const templates = await request<{ error: string }>('/api/rulesets/templates', { cookie: owner.cookie });
    assert.equal(templates.status, 410);
    const version = await request<{ error: string }>(`/api/rulesets/versions/${randomUUID()}`, { cookie: owner.cookie });
    assert.equal(version.status, 410);
    const draw = await request<{ error: string }>(`/api/matches/${m3.id}/seats/draw`, { method: 'POST', cookie: owner.cookie, body: {} });
    assert.equal(draw.status, 410);
    const hands = await request<{ error: string }>(`/api/matches/${m3.id}/hands`, { method: 'POST', cookie: owner.cookie, body: {} });
    assert.equal(hands.status, 410);
    const checkins = await request<{ error: string }>(`/api/matches/${m3.id}/check-ins`, { method: 'POST', cookie: owner.cookie, body: {} });
    assert.equal(checkins.status, 410);
    const jr = await request<{ error: string }>(`/api/matches/${m3.id}/join-requests`, { method: 'POST', cookie: owner.cookie, body: {} });
    assert.equal(jr.status, 410);
    const templateCreate = await request<{ error: string }>('/api/matches', {
      method: 'POST', cookie: owner.cookie, body: { rulesetVersionId: randomUUID() },
    });
    assert.equal(templateCreate.status, 410);

    // Admin: gate, players, matches, correction, delete.
    const adminDenied = await request<{ error: string }>('/api/admin/players', { cookie: owner.cookie });
    assert.equal(adminDenied.status, 403);
    const adminEmail = `final_admin_${runId}@example.com`;
    process.env.ADMIN_EMAILS = adminEmail;
    const admin = await player('Final admin', adminEmail);
    const meAdmin = await request<{ isAdmin: boolean }>('/api/me', { cookie: admin.cookie });
    assert.equal(meAdmin.data.isAdmin, true);
    const players = await request<{ players: { id: string; displayName: string; matchCount: number }[] }>('/api/admin/players', { cookie: admin.cookie });
    assert.equal(players.status, 200);
    const ownerRow = players.data.players.find((p) => p.id === owner.principalId);
    assert.ok(ownerRow && ownerRow.matchCount >= 3, 'admin players lists the host with a match count');
    const adminMatches = await request<MatchView[]>('/api/admin/matches', { cookie: admin.cookie });
    assert.equal(adminMatches.status, 200);
    assert.equal(adminMatches.data.some((m) => m.id === match.id), true);

    // Admin may read any match detail (data management) even without
    // membership; a non-member who is not admin still gets 403.
    const adminDetail = await request<MatchView>(`/api/matches/${match.id}`, { cookie: admin.cookie });
    assert.equal(adminDetail.status, 200);
    assert.equal(adminDetail.data.id, match.id);
    const stranger = await player('Final stranger');
    const strangerDetail = await request<{ error: string }>(`/api/matches/${match.id}`, { cookie: stranger.cookie });
    assert.equal(strangerDetail.status, 403);
    const adminPatch = await request<MatchView>(`/api/admin/matches/${match.id}/final-scores`, {
      method: 'PATCH', cookie: admin.cookie,
      body: { scores: [{ wind: 'E', score: 400 }, { wind: 'S', score: 300 }, { wind: 'W', score: 200 }, { wind: 'N', score: 100 }] },
    });
    assert.equal(adminPatch.status, 200);
    assert.ok(adminPatch.data.correctedAt);
    const adminPatchBad = await request<{ error: string }>(`/api/admin/matches/${match.id}/final-scores`, {
      method: 'PATCH', cookie: admin.cookie,
      body: { scores: [{ wind: 'E', score: 1 }, { wind: 'S', score: 1 }, { wind: 'W', score: 1 }, { wind: 'N', score: 1 }] },
    });
    assert.equal(adminPatchBad.status, 400);
    const delTarget = await create(owner, '4p');
    const adminDel = await request<{ deleted: boolean }>(`/api/admin/matches/${delTarget.data.match.id}`, { method: 'DELETE', cookie: admin.cookie });
    assert.equal(adminDel.status, 200);
    assert.equal(adminDel.data.deleted, true);
    const ownerMineAfterDel = await mine(owner);
    assert.equal(ownerMineAfterDel.data.some((m) => m.id === delTarget.data.match.id), false);
    delete process.env.ADMIN_EMAILS;

    // Join-code failure rate limit is unchanged: 10 failures -> 404s, 11th -> 429.
    // (Same app instance: the earlier successful by-code lookup above does not
    // spend the failure budget, so this sequence is exact.)
    let lastStatus = 0;
    let lastRetryAfter: string | null = null;
    for (let i = 0; i < 11; i++) {
      const res = await request<{ error: string }>('/api/matches/by-code/ZZZZZZ', { cookie: owner.cookie });
      lastStatus = res.status;
      if (i < 10) assert.equal(res.status, 404, `failure ${i + 1} is a plain 404`);
    }
    assert.equal(lastStatus, 429, 'the 11th failure in 10 minutes is rate-limited');
    // Retry-After is asserted via a raw fetch because the helper drops headers.
    const retryRes = await fetch(`${baseUrl}/api/matches/by-code/ZZZZZZ`, {
      headers: { origin: 'http://127.0.0.1:5173', cookie: owner.cookie },
    });
    await retryRes.json();
    assert.equal(retryRes.status, 429);
    assert.ok(retryRes.headers.get('retry-after'), '429 carries a Retry-After header');
    void lastRetryAfter;
  } finally {
    await app.close();
    await pool.end();
  }
});
