import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import '../env.js';
import { ensureAuthSchema, pool } from '../db.js';
import { buildApp } from '../index.js';

interface ClientSession {
  cookie: string;
  token: string;
  principalId: string;
  type: 'account' | 'guest';
  displayName: string;
}

export async function runStageBE2E(): Promise<{ assertionsPassed: number }> {
  let assertionsPassed = 0;
  const check = (cond: unknown, message: string): void => {
    assert.ok(cond, message);
    assertionsPassed++;
  };
  const checkEq = <T>(actual: T, expected: T, message: string): void => {
    assert.deepEqual(actual, expected, message);
    assertionsPassed++;
  };

  await ensureAuthSchema();
  const app = await buildApp();
  const address = await app.listen({ port: 0, host: '127.0.0.1' });
  const baseUrl = address.replace('[::1]', '127.0.0.1');
  const wsBaseUrl = baseUrl.replace(/^http/, 'ws');

  try {
    const requestJson = async <T>(
      path: string,
      opts: {
        method?: string;
        body?: unknown;
        cookie?: string;
        token?: string;
        origin?: string;
      } = {},
    ): Promise<{ status: number; data: T; setCookies: string[] }> => {
      const headers: Record<string, string> = {
        origin: opts.origin ?? 'http://127.0.0.1:5173',
      };
      if (opts.body !== undefined) {
        headers['content-type'] = 'application/json';
      }
      if (opts.cookie) {
        headers['cookie'] = opts.cookie;
      }
      if (opts.token) {
        headers['authorization'] = `Bearer ${opts.token}`;
      }
      const res = await fetch(`${baseUrl}${path}`, {
        method: opts.method ?? 'GET',
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      });
      const setCookies = res.headers.getSetCookie?.() ?? [];
      const text = await res.text();
      const data = (text ? JSON.parse(text) : undefined) as T;
      return { status: res.status, data, setCookies };
    };

    for (const origin of ['capacitor://localhost', 'https://localhost']) {
      const preflight = await fetch(`${baseUrl}/api/me`, {
        method: 'OPTIONS',
        headers: { origin, 'access-control-request-method': 'GET', 'access-control-request-headers': 'authorization' },
      });
      checkEq(preflight.status, 204, `Native preflight accepted for ${origin}`);
      checkEq(preflight.headers.get('access-control-allow-origin'), origin, `Native CORS origin echoed for ${origin}`);
      check(preflight.headers.get('access-control-allow-headers')?.toLowerCase().includes('authorization'), `Native bearer preflight accepted for ${origin}`);
    }

    // 0. Unauthenticated /api/me must return 401
    const unauthMe = await requestJson('/api/me');
    checkEq(unauthMe.status, 401, 'Unauthenticated GET /api/me returns 401');

    // 1. Register 2 email accounts + 2 anonymous guests
    const runId = randomUUID().slice(0, 8);
    const registerEmailAccount = async (email: string, name: string): Promise<ClientSession> => {
      const signUp = await requestJson<{ token: string; user: { id: string } }>('/api/auth/sign-up/email', {
        method: 'POST',
        body: { email, password: 'Password123!StrongEnough', name },
      });
      checkEq(signUp.status, 200, `Email sign-up for ${email} returns 200`);
      check(Boolean(signUp.data?.user?.id), `Email sign-up returns user.id for ${email}`);
      const cookie = signUp.setCookies.map((c) => c.split(';')[0]).join('; ');
      check(cookie.length > 0, `Email sign-up sets session cookie for ${email}`);

      const me = await requestJson<{
        principal: { id: string; type: 'account' | 'guest'; displayName: string; createdAt: string };
      }>('/api/me', { cookie });
      checkEq(me.status, 200, `GET /api/me for ${email} returns 200`);
      checkEq(me.data.principal.type, 'account', `Principal type for ${email} is 'account'`);
      checkEq(me.data.principal.displayName, name, `Principal displayName for ${email} matches`);

      return {
        cookie,
        token: signUp.data.token,
        principalId: me.data.principal.id,
        type: me.data.principal.type,
        displayName: me.data.principal.displayName,
      };
    };

    const signInAnonymousGuest = async (label: string, origin?: string): Promise<ClientSession> => {
      const anon = await requestJson<{ token: string; user: { id: string; isAnonymous: boolean } }>(
        '/api/auth/sign-in/anonymous',
        {
          method: 'POST',
          body: {},
          origin,
        },
      );
      checkEq(anon.status, 200, `Anonymous sign-in for ${label} returns 200`);
      check(Boolean(anon.data?.user?.id), `Anonymous sign-in returns user.id for ${label}`);
      const cookie = anon.setCookies.map((c) => c.split(';')[0]).join('; ');
      check(cookie.length > 0, `Anonymous sign-in sets session cookie for ${label}`);

      const me = await requestJson<{
        principal: { id: string; type: 'account' | 'guest'; displayName: string; createdAt: string };
      }>('/api/me', { cookie });
      checkEq(me.status, 200, `GET /api/me for ${label} returns 200`);
      checkEq(me.data.principal.type, 'guest', `Principal type for ${label} is 'guest'`);

      return {
        cookie,
        token: anon.data.token,
        principalId: me.data.principal.id,
        type: me.data.principal.type,
        displayName: me.data.principal.displayName,
      };
    };

    const acct1 = await registerEmailAccount(`host_${runId}@example.com`, '东家房主');
    const acct2 = await registerEmailAccount(`player2_${runId}@example.com`, '南家会员');
    const guest1 = await signInAnonymousGuest('guest1', 'capacitor://localhost');
    const guest2 = await signInAnonymousGuest('guest2', 'https://localhost');

    // 2. Fetch ruleset templates & version
    const tplRes = await requestJson<
      {
        templateId: string;
        templateKey: string;
        kind: string;
        scope: string;
        versionId: string;
        name: string;
        reviewStatus: string;
        config: Record<string, unknown>;
      }[]
    >('/api/rulesets/templates');
    checkEq(tplRes.status, 200, 'GET /api/rulesets/templates returns 200');
    check(tplRes.data.length >= 4, 'At least 4 system ruleset templates returned');

    const house4p = tplRes.data.find((t) => t.templateKey === 'house_4p');
    check(Boolean(house4p), 'Found house_4p template');

    const verRes = await requestJson<{
      versionId: string;
      config: Record<string, unknown>;
      configHash: string;
    }>(`/api/rulesets/versions/${house4p!.versionId}`);
    checkEq(verRes.status, 200, 'GET /api/rulesets/versions/:versionId returns 200');
    checkEq(verRes.data.versionId, house4p!.versionId, 'Version ID matches house_4p versionId');
    check(verRes.data.configHash.length === 64, 'configHash is 64-char sha256 hex');

    // 3. Create match (4p house template) as acct1 (owner)
    const createRes = await requestJson<{
      match: { id: string; inviteCode: string; status: string };
    }>('/api/matches', {
      method: 'POST',
      cookie: acct1.cookie,
      body: { rulesetVersionId: house4p!.versionId },
    });
    checkEq(createRes.status, 200, 'POST /api/matches returns 200');
    const matchId = createRes.data.match.id;
    check(Boolean(matchId), 'Match ID returned');
    checkEq(createRes.data.match.status, 'preparing', 'Initial match status is preparing');

    // M8: ad-hoc configs retain only canonical honba/ryuukyoku fields;
    // stale aliases from the enriched template must not override edits.
    const canonicalCreate = await requestJson<{ match: { id: string } }>('/api/matches', {
      method: 'POST',
      cookie: acct1.cookie,
      body: {
        config: {
          ...house4p!.config,
          honba: { ronTotal: 600, tsumoPerPayer: 200, ron: 300, perPayer: 100 },
          honbaPerPayer: 100,
          honbaRon: 300,
          ryuukyokuPenaltyTotal: 2400,
          ryuukyokuPoolTotal: 3000,
          notenPenaltyTotal: 3000,
        },
      },
    });
    checkEq(canonicalCreate.status, 200, 'Ad-hoc match with canonical and stale aliases creates successfully');
    const canonicalStored = await pool.query<{ rules_snapshot: Record<string, unknown> }>(
      'SELECT rules_snapshot FROM app.matches WHERE id = $1',
      [canonicalCreate.data.match.id],
    );
    const canonicalSnapshot = canonicalStored.rows[0].rules_snapshot;
    checkEq(canonicalSnapshot.honba, { ronTotal: 600, tsumoPerPayer: 200 }, 'Canonical honba wins and is stored alone');
    checkEq(canonicalSnapshot.ryuukyokuPenaltyTotal, 2400, 'Canonical ryuukyoku penalty wins');
    for (const alias of ['honbaPerPayer', 'honbaRon', 'ryuukyokuPoolTotal', 'notenPenaltyTotal']) {
      check(!(alias in canonicalSnapshot), `Stored ad-hoc config omits ${alias}`);
    }
    const canonicalView = await requestJson(`/api/matches/${canonicalCreate.data.match.id}`, { cookie: acct1.cookie });
    checkEq(canonicalView.status, 200, 'Canonicalized match remains readable by the engine');

    const aliasCreate = await requestJson<{ match: { id: string } }>('/api/matches', {
      method: 'POST',
      cookie: acct1.cookie,
      body: {
        config: {
          playerCount: 4,
          startingPoints: 25000,
          returnPoints: 30000,
          honba: { ronTotal: 600 },
          honbaPerPayer: 200,
          ryuukyokuPoolTotal: 2400,
        },
      },
    });
    checkEq(aliasCreate.status, 200, 'Partial honba object merges legacy payer and penalty aliases');
    const aliasStored = await pool.query<{ rules_snapshot: Record<string, unknown> }>(
      'SELECT rules_snapshot FROM app.matches WHERE id = $1',
      [aliasCreate.data.match.id],
    );
    checkEq(aliasStored.rows[0].rules_snapshot.honba, { ronTotal: 600, tsumoPerPayer: 200 },
      'Missing canonical honba component is filled from legacy payer');
    checkEq(aliasStored.rows[0].rules_snapshot.ryuukyokuPenaltyTotal, 2400,
      'Legacy ryuukyoku total is stored under its canonical key');
    check(!('honbaPerPayer' in aliasStored.rows[0].rules_snapshot), 'Merged honba alias is not stored');
    check(!('ryuukyokuPoolTotal' in aliasStored.rows[0].rules_snapshot), 'Merged ryuukyoku alias is not stored');

    // Verify GET /api/matches?mine=1
    const mineRes = await requestJson<{ id: string; status: string; playerCount: number; createdAt: string }[]>(
      '/api/matches?mine=1',
      { cookie: acct1.cookie },
    );
    checkEq(mineRes.status, 200, 'GET /api/matches?mine=1 returns 200');
    check(
      mineRes.data.some((m) => m.id === matchId),
      'Created match appears in owner GET /api/matches?mine=1',
    );

    // Non-member cannot read GET /api/matches/:id before joining (403)
    const forbiddenView = await requestJson(`/api/matches/${matchId}`, { cookie: acct2.cookie });
    checkEq(forbiddenView.status, 403, 'Non-member GET /api/matches/:id returns 403');

    // Connect WebSocket as owner to verify all real-time events
    const wsTicketRes = await requestJson<{ ticket: string; expiresAt: string }>(
      `/api/matches/${matchId}/ws-tickets`,
      { method: 'POST', cookie: acct1.cookie, body: {} },
    );
    checkEq(wsTicketRes.status, 200, 'POST /api/matches/:id/ws-tickets returns 200');
    check(Boolean(wsTicketRes.data.ticket), 'WS ticket returned');

    const wsTypes: Record<string, true> = {};
    const wsOpen = Promise.withResolvers<void>();
    const wsDone = Promise.withResolvers<void>();
    const ws = new WebSocket(`${wsBaseUrl}/ws/matches/${matchId}?ticket=${encodeURIComponent(wsTicketRes.data.ticket)}`);
    ws.addEventListener('open', () => wsOpen.resolve());
    ws.addEventListener('error', (err) => wsOpen.reject(err));
    ws.addEventListener('message', (ev) => {
      const parsed = JSON.parse(String(ev.data)) as { type: string; payload: unknown };
      wsTypes[parsed.type] = true;
      if (parsed.type === 'settlement_confirmed') {
        wsDone.resolve();
      }
    });
    await wsOpen.promise;

    // 3b. F1 check: unapproved check-in with a valid token must be rejected with 403 {error:'check_in_not_approved'}
    const unapprovedTokRes = await requestJson<{ token: string; expiresAt: string }>(
      `/api/matches/${matchId}/check-in-tokens`,
      { method: 'POST', cookie: acct1.cookie, body: {} },
    );
    checkEq(unapprovedTokRes.status, 200, 'POST check-in-tokens for unapproved probe returns 200');
    const unapprovedCiRes = await requestJson<{ error: string }>(
      `/api/matches/${matchId}/check-ins`,
      {
        method: 'POST',
        cookie: acct2.cookie,
        body: { token: unapprovedTokRes.data.token },
      },
    );
    checkEq(unapprovedCiRes.status, 403, 'Unapproved check-in returns 403');
    checkEq(unapprovedCiRes.data.error, 'check_in_not_approved', 'Unapproved check-in error code is check_in_not_approved');

    // 4. Join-requests and owner approvals for seats 1, 2, 3
    const joinRequesters: { session: ClientSession; seatNo: number }[] = [
      { session: acct2, seatNo: 1 },
      { session: guest1, seatNo: 2 },
      { session: guest2, seatNo: 3 },
    ];
    for (const { session, seatNo } of joinRequesters) {
      const jr = await requestJson<{ joinRequestId: string; status: string }>(
        `/api/matches/${matchId}/join-requests`,
        { method: 'POST', cookie: session.cookie, body: {} },
      );
      checkEq(jr.status, 200, `POST join-requests for seat ${seatNo} returns 200`);
      checkEq(jr.data.status, 'pending', `Join request status is pending`);

      const approve = await requestJson<{ ok: boolean; seatNo: number }>(
        `/api/matches/${matchId}/join-requests/${jr.data.joinRequestId}/approve`,
        { method: 'POST', cookie: acct1.cookie, body: { seatNo } },
      );
      checkEq(approve.status, 200, `POST approve join-request for seat ${seatNo} returns 200`);
    }

    // 5. Check-in tokens & 4 check-ins (seats 0, 1, 2, 3)
    const playersForCheckIn: { session: ClientSession; expectedSeatNo: number; alias?: string }[] = [
      { session: acct1, expectedSeatNo: 0 },
      { session: acct2, expectedSeatNo: 1 },
      { session: guest1, expectedSeatNo: 2, alias: '西家访客' },
      { session: guest2, expectedSeatNo: 3, alias: '北家访客' },
    ];

    for (const p of playersForCheckIn) {
      const tokRes = await requestJson<{ token: string; expiresAt: string }>(
        `/api/matches/${matchId}/check-in-tokens`,
        { method: 'POST', cookie: acct1.cookie, body: {} },
      );
      checkEq(tokRes.status, 200, `POST check-in-tokens for seat ${p.expectedSeatNo} returns 200`);

      const ciRes = await requestJson<{ seat: { seatNo: number }; grantId: string }>(
        `/api/matches/${matchId}/check-ins`,
        {
          method: 'POST',
          cookie: p.session.cookie,
          body: {
            token: tokRes.data.token,
            ...(p.alias ? { alias: p.alias } : {}),
          },
        },
      );
      checkEq(ciRes.status, 200, `POST check-ins for seat ${p.expectedSeatNo} returns 200`);
      checkEq(ciRes.data.seat.seatNo, p.expectedSeatNo, `Checked-in seatNo matches ${p.expectedSeatNo}`);
      check(Boolean(ciRes.data.grantId), `grantId returned for seat ${p.expectedSeatNo}`);

      // Single-use token check: re-using same token must fail (400)
      const replayRes = await requestJson(`/api/matches/${matchId}/check-ins`, {
        method: 'POST',
        cookie: p.session.cookie,
        body: { token: tokRes.data.token },
      });
      checkEq(replayRes.status, 400, `Reusing consumed check-in token returns 400`);
    }

    // Verify GET /api/matches/:id shows 4 checkedIn seats
    const matchBeforeFinalize = await requestJson<{
      match: { id: string; status: string };
      seats: { seatNo: number; principalId: string; displayName: string; points: number; status: string }[];
      checkedIn: number;
    }>(`/api/matches/${matchId}`, { cookie: guest1.cookie });
    checkEq(matchBeforeFinalize.status, 200, 'Guest member can view GET /api/matches/:id');
    checkEq(matchBeforeFinalize.data.checkedIn, 4, 'checkedIn count is 4');
    checkEq(matchBeforeFinalize.data.seats[2].displayName, '西家访客', 'Guest 1 alias updated in seat displayName');
    checkEq(matchBeforeFinalize.data.seats[3].displayName, '北家访客', 'Guest 2 alias updated in seat displayName');

    // 6. Finalize seats -> status becomes in_progress, score_accounts created at 25,000
    const finSeats = await requestJson<{
      seats: { seatNo: number; principalId: string; points: number; status: string }[];
    }>(`/api/matches/${matchId}/seats/finalize`, {
      method: 'POST',
      cookie: acct1.cookie,
      body: {},
    });
    checkEq(finSeats.status, 200, 'POST /api/matches/:id/seats/finalize returns 200');
    checkEq(finSeats.data.seats.length, 4, '4 seats finalized');
    check(
      finSeats.data.seats.every((s) => s.points === 25000),
      'All 4 seats start at 25,000 points',
    );

    // 7. Hand 1: marks seat0 riichi -> preview -> results (tsumo by seat0, 3han 30fu)
    const h1Start = await requestJson<{
      hand: {
        id: string;
        roundWind: string;
        roundNumber: number;
        dealerSeatNo: number;
        honba: number;
        riichiPool: number;
        markRevision: number;
        resultRevision: number;
      };
    }>(`/api/matches/${matchId}/hands`, {
      method: 'POST',
      cookie: acct2.cookie,
      body: {},
    });
    checkEq(h1Start.status, 200, 'POST /api/matches/:id/hands (Hand 1) returns 200');
    const hand1Id = h1Start.data.hand.id;
    checkEq(h1Start.data.hand.roundWind, 'E', 'Hand 1 is East wind');
    checkEq(h1Start.data.hand.roundNumber, 1, 'Hand 1 is round 1');
    checkEq(h1Start.data.hand.dealerSeatNo, 0, 'Hand 1 dealer is seat 0');
    checkEq(h1Start.data.hand.honba, 0, 'Hand 1 honba is 0');
    checkEq(h1Start.data.hand.riichiPool, 0, 'Hand 1 riichiPool is 0');

    // Spectators can read the table but cannot change an open hand.
    const spectator = await registerEmailAccount(`spectator_${runId}@example.com`, '观战者');
    await pool.query(
      `INSERT INTO app.match_members (match_id, principal_id, role, status)
       VALUES ($1, $2, 'spectator', 'active')`,
      [matchId, spectator.principalId],
    );
    const spectatorView = await requestJson(`/api/matches/${matchId}`, { cookie: spectator.cookie });
    checkEq(spectatorView.status, 200, 'Spectator can read the match');
    const spectatorMark = await requestJson(`/api/matches/${matchId}/hands/${hand1Id}/marks`, {
      method: 'POST',
      cookie: spectator.cookie,
      body: { seatNo: 0, riichi: true },
    });
    checkEq(spectatorMark.status, 403, 'Spectator cannot write a mark');

    // Mark seat 0 riichi
    const h1Mark = await requestJson<{ markRevision: number }>(
      `/api/matches/${matchId}/hands/${hand1Id}/marks`,
      {
        method: 'POST',
        cookie: acct1.cookie,
        body: { seatNo: 0, riichi: true },
      },
    );
    checkEq(h1Mark.status, 200, 'POST marks seat 0 riichi returns 200');
    checkEq(h1Mark.data.markRevision, 1, 'markRevision bumped to 1');

    // Idempotent mark repeat by same principal
    const h1MarkRepeat = await requestJson<{ markRevision: number }>(
      `/api/matches/${matchId}/hands/${hand1Id}/marks`,
      {
        method: 'POST',
        cookie: acct1.cookie,
        body: { seatNo: 0, riichi: true },
      },
    );
    checkEq(h1MarkRepeat.status, 200, 'Idempotent repeat of mark returns 200');
    checkEq(h1MarkRepeat.data.markRevision, 1, 'Idempotent repeat keeps markRevision at 1');

    // F6 check: stale expectedMarkRevision on marks returns 409 {error:'stale_mark_revision'}
    const h1StaleMark = await requestJson<{ error: string }>(
      `/api/matches/${matchId}/hands/${hand1Id}/marks`,
      {
        method: 'POST',
        cookie: acct2.cookie,
        body: { seatNo: 1, riichi: true, expectedMarkRevision: 0 },
      },
    );
    checkEq(h1StaleMark.status, 409, 'Stale expectedMarkRevision on marks returns 409');
    checkEq(h1StaleMark.data.error, 'stale_mark_revision', 'Stale mark error is stale_mark_revision');

    // F9b & F9c checks: invalid ResultInput shape and invalid riichiDeclarationDealInSeatNo context return clean 400
    const badShapePreview = await requestJson<{ error: string; message: string }>(
      `/api/matches/${matchId}/hands/${hand1Id}/preview`,
      {
        method: 'POST',
        cookie: acct1.cookie,
        body: { resultInput: { kind: 'ron', winners: [null] } },
      },
    );
    checkEq(badShapePreview.status, 400, 'Invalid winner element in preview returns 400');
    checkEq(badShapePreview.data.error, 'invalid_winner', 'Invalid winner returns clean error code');

    const badRiichiCancelPreview = await requestJson<{ error: string }>(
      `/api/matches/${matchId}/hands/${hand1Id}/preview`,
      {
        method: 'POST',
        cookie: acct1.cookie,
        body: {
          resultInput: {
            kind: 'tsumo',
            winners: [{ seatNo: 0, han: 3, fu: 30 }],
            riichiDeclarationDealInSeatNo: 0,
          },
        },
      },
    );
    checkEq(badRiichiCancelPreview.status, 400, 'riichiDeclarationDealInSeatNo on tsumo returns 400');
    checkEq(
      badRiichiCancelPreview.data.error,
      'invalid_riichi_declaration_deal_in',
      'riichiDeclarationDealInSeatNo context validation error code matches',
    );

    const rawFuPreview = await requestJson<{ perSeat: { netPoints: number }[] }>(
      `/api/matches/${matchId}/hands/${hand1Id}/preview`,
      {
        method: 'POST',
        cookie: acct1.cookie,
        body: { resultInput: { kind: 'tsumo', winners: [{ seatNo: 0, han: 3, fu: 22 }] } },
      },
    );
    checkEq(rawFuPreview.status, 200, 'Raw 22 fu is accepted and rounded by the engine');

    const tripleRonPreview = await requestJson<{
      perSeat: { netPoints: number }[];
      nextHand: { riichiPool: number };
    }>(`/api/matches/${matchId}/hands/${hand1Id}/preview`, {
      method: 'POST',
      cookie: acct1.cookie,
      body: {
        resultInput: {
          kind: 'ron',
          winners: [1, 2, 3].map((seatNo) => ({ seatNo, han: 2, fu: 30, dealInSeatNo: 0 })),
          riichiDeclarationDealInSeatNo: 0,
        },
      },
    });
    checkEq(tripleRonPreview.status, 200, 'Declaration-tile triple ron is accepted as an abortive draw');
    checkEq(tripleRonPreview.data.perSeat.map((seat) => seat.netPoints), [0, 0, 0, 0],
      'Cancelled declaration does not charge the discarder during abortive triple ron');
    checkEq(tripleRonPreview.data.nextHand.riichiPool, 0, 'Cancelled declaration does not enter the carryover pool');

    // Preview Hand 1 (tsumo by seat 0, 3han 30fu: dealer 3han 30fu tsumo = 2000 all = +6000; seat 0 riichi -1000 +1000 pool = net +6000)
    const h1Input = {
      kind: 'tsumo',
      winners: [{ seatNo: 0, han: 3, fu: 30 }],
    };
    const h1Preview = await requestJson<{
      perSeat: { seatNo: number; netPoints: number }[];
      nextHand: { dealerSeatNo: number; honba: number; riichiPool: number };
    }>(`/api/matches/${matchId}/hands/${hand1Id}/preview`, {
      method: 'POST',
      cookie: acct1.cookie,
      body: { resultInput: h1Input },
    });
    checkEq(h1Preview.status, 200, 'POST Hand 1 preview returns 200');
    checkEq(
      h1Preview.data.perSeat.map((s) => s.netPoints),
      [6000, -2000, -2000, -2000],
      'Hand 1 preview perSeat netPoints are [+6000, -2000, -2000, -2000]',
    );
    checkEq(h1Preview.data.nextHand.honba, 1, 'Hand 1 preview nextHand.honba is 1 (dealer renchan)');

    // Submitting Hand 1 results with wrong confirmedMarkRevision returns 409
    const h1Stale = await requestJson(`/api/matches/${matchId}/hands/${hand1Id}/results`, {
      method: 'POST',
      cookie: acct1.cookie,
      body: { resultInput: h1Input, confirmedMarkRevision: 0 },
    });
    checkEq(h1Stale.status, 409, 'Mismatched confirmedMarkRevision returns 409');

    // Settle Hand 1 with clientEventId
    const h1ClientEventId = randomUUID();
    const h1Result = await requestJson<{
      perSeat: { seatNo: number; netPoints: number }[];
      nextHand: { dealerSeatNo: number; honba: number; riichiPool: number };
    }>(`/api/matches/${matchId}/hands/${hand1Id}/results`, {
      method: 'POST',
      cookie: acct1.cookie,
      body: { resultInput: h1Input, confirmedMarkRevision: 1, clientEventId: h1ClientEventId },
    });
    checkEq(h1Result.status, 200, 'POST Hand 1 results returns 200');
    checkEq(
      h1Result.data.perSeat.map((s) => s.netPoints),
      [6000, -2000, -2000, -2000],
      'Hand 1 settled netPoints match preview',
    );

    // F7 check: Retry with the SAME clientEventId returns 200 with the ORIGINAL settlement payload
    const h1IdempotentRetry = await requestJson<{
      perSeat: { seatNo: number; netPoints: number }[];
      nextHand: { dealerSeatNo: number; honba: number; riichiPool: number };
    }>(`/api/matches/${matchId}/hands/${hand1Id}/results`, {
      method: 'POST',
      cookie: acct1.cookie,
      body: { resultInput: h1Input, confirmedMarkRevision: 1, clientEventId: h1ClientEventId },
    });
    checkEq(h1IdempotentRetry.status, 200, 'Retry with same clientEventId returns 200');
    checkEq(
      h1IdempotentRetry.data,
      h1Result.data,
      'Retry with same clientEventId returns identical original settlement payload',
    );

    const reusedIdWithChangedInput = await requestJson<{ error: string }>(
      `/api/matches/${matchId}/hands/${hand1Id}/results`,
      {
        method: 'POST',
        cookie: acct1.cookie,
        body: {
          resultInput: { kind: 'tsumo', winners: [{ seatNo: 1, han: 3, fu: 30 }] },
          confirmedMarkRevision: 1,
          clientEventId: h1ClientEventId,
        },
      },
    );
    checkEq(reusedIdWithChangedInput.status, 409, 'Reusing a result event ID with different input conflicts');
    checkEq(reusedIdWithChangedInput.data.error, 'client_event_id_conflict', 'Changed retry reports event ID conflict');

    // Re-settling Hand 1 with a different clientEventId must return 409
    const h1Duplicate = await requestJson(`/api/matches/${matchId}/hands/${hand1Id}/results`, {
      method: 'POST',
      cookie: acct1.cookie,
      body: { resultInput: h1Input, confirmedMarkRevision: 1, clientEventId: randomUUID() },
    });
    checkEq(h1Duplicate.status, 409, 'Re-settling Hand 1 with different clientEventId returns 409');
    // 8. Hand 2: ron with riichi pool (seat 1 marks riichi -> seat 2 rons seat 3, 3han 30fu)
    const h2Start = await requestJson<{
      hand: {
        id: string;
        roundWind: string;
        roundNumber: number;
        dealerSeatNo: number;
        honba: number;
        riichiPool: number;
        markRevision: number;
      };
    }>(`/api/matches/${matchId}/hands`, {
      method: 'POST',
      cookie: guest1.cookie,
      body: {},
    });
    checkEq(h2Start.status, 200, 'POST /api/matches/:id/hands (Hand 2) returns 200');
    const hand2Id = h2Start.data.hand.id;
    checkEq(h2Start.data.hand.honba, 1, 'Hand 2 starts with honba = 1');

    // Seat 1 declares riichi in Hand 2 (puts 1,000 into pool to be claimed by the ron winner)
    const h2Mark = await requestJson<{ markRevision: number }>(
      `/api/matches/${matchId}/hands/${hand2Id}/marks`,
      {
        method: 'POST',
        cookie: acct2.cookie,
        body: { seatNo: 1, riichi: true },
      },
    );
    checkEq(h2Mark.status, 200, 'POST Hand 2 mark seat 1 riichi returns 200');
    checkEq(h2Mark.data.markRevision, 1, 'Hand 2 markRevision is 1');

    // Seat 2 rons Seat 3 (3han 30fu non-dealer = 3900 + 300 honba = 4200, plus +1000 riichi pool = +5200)
    const h2Input = {
      kind: 'ron',
      winners: [{ seatNo: 2, han: 3, fu: 30, dealInSeatNo: 3 }],
    };
    const h2Result = await requestJson<{
      perSeat: { seatNo: number; netPoints: number }[];
      nextHand: { dealerSeatNo: number; honba: number; riichiPool: number };
    }>(`/api/matches/${matchId}/hands/${hand2Id}/results`, {
      method: 'POST',
      cookie: guest1.cookie,
      body: { resultInput: h2Input, confirmedMarkRevision: 1 },
    });
    checkEq(h2Result.status, 200, 'POST Hand 2 results (ron with pool) returns 200');
    checkEq(
      h2Result.data.perSeat.map((s) => s.netPoints),
      [0, -1000, 5200, -4200],
      'Hand 2 perSeat netPoints are [0, -1000, +5200, -4200]',
    );
    checkEq(h2Result.data.nextHand.dealerSeatNo, 1, 'Dealer rotates to seat 1 after non-dealer ron');
    checkEq(h2Result.data.nextHand.honba, 0, 'Honba resets to 0 after non-dealer win');
    checkEq(h2Result.data.nextHand.riichiPool, 0, 'Riichi pool is 0 after ron winner claims pool');

    // Verify GET /api/matches/:id/hands?limit=20
    const handsList = await requestJson<{ handId: string; kind: string; perSeat: unknown[] }[]>(
      `/api/matches/${matchId}/hands?limit=20`,
      { cookie: acct1.cookie },
    );
    checkEq(handsList.status, 200, 'GET /api/matches/:id/hands returns 200');
    checkEq(handsList.data.length, 2, '2 settled hands returned');
    checkEq(handsList.data[0].kind, 'tsumo', 'First hand kind is tsumo');
    checkEq(handsList.data[1].kind, 'ron', 'Second hand kind is ron');

    // 9. Finish match
    const finishRes = await requestJson<{
      finished: boolean;
      provisionalRankings: { rank: number; seatNo: number; points: number }[];
    }>(`/api/matches/${matchId}/finish`, {
      method: 'POST',
      cookie: acct1.cookie,
      body: {},
    });
    checkEq(finishRes.status, 200, 'POST /api/matches/:id/finish returns 200');
    checkEq(finishRes.data.finished, true, 'Match finished is true');
    checkEq(finishRes.data.provisionalRankings.length, 4, '4 provisional rankings returned');
    // Points after Hand 2:
    // Seat 0: 25000 + 6000 + 0 = 31000 (rank 1)
    // Seat 2: 25000 - 2000 + 5200 = 28200 (rank 2)
    // Seat 1: 25000 - 2000 - 1000 = 22000 (rank 3)
    // Seat 3: 25000 - 2000 - 4200 = 18800 (rank 4)
    checkEq(
      finishRes.data.provisionalRankings.map((r) => ({ seatNo: r.seatNo, points: r.points })),
      [
        { seatNo: 0, points: 31000 },
        { seatNo: 2, points: 28200 },
        { seatNo: 1, points: 22000 },
        { seatNo: 3, points: 18800 },
      ],
      'Provisional rankings match expected final points [31000, 28200, 22000, 18800]',
    );

    // 10. Settlement preview & confirm
    const settlePreview = await requestJson<{
      terminalTenths: number[];
    }>(`/api/matches/${matchId}/settlement/preview`, {
      cookie: acct1.cookie,
    });
    checkEq(settlePreview.status, 200, 'GET /api/matches/:id/settlement/preview returns 200');
    checkEq(settlePreview.data.terminalTenths.length, 4, 'terminalTenths has 4 entries');
    checkEq(
      settlePreview.data.terminalTenths.reduce((a, b) => a + b, 0),
      0,
      'terminalTenths sum to 0 (zero-sum competition score)',
    );

    const settleConfirm = await requestJson<{ settlementId: string }>(
      `/api/matches/${matchId}/settlement/confirm`,
      {
        method: 'POST',
        cookie: acct1.cookie,
        body: {},
      },
    );
    checkEq(settleConfirm.status, 200, 'POST /api/matches/:id/settlement/confirm returns 200');
    check(Boolean(settleConfirm.data.settlementId), 'settlementId returned');

    // 11. Database Assertions:
    // (a) score_accounts sum == total start points (4 * 25000 = 100000)
    const accSumRes = await pool.query<{
      opening_sum: number;
      current_sum: number;
      seat_count: number;
    }>(
      `SELECT
         SUM(a.opening_balance)::int AS opening_sum,
         SUM(a.opening_balance + COALESCE(e_sum.total_delta, 0))::int AS current_sum,
         COUNT(*) FILTER (WHERE a.kind = 'seat')::int AS seat_count
       FROM app.score_accounts a
       LEFT JOIN (
         SELECT account_id, SUM(amount)::int AS total_delta
         FROM app.score_entries
         GROUP BY account_id
       ) e_sum ON e_sum.account_id = a.id
       WHERE a.match_id = $1`,
      [matchId],
    );
    checkEq(accSumRes.rows[0].seat_count, 4, '4 seat score_accounts exist for match');
    checkEq(accSumRes.rows[0].opening_sum, 100000, 'score_accounts opening_balance sum == 100,000');
    checkEq(accSumRes.rows[0].current_sum, 100000, 'score_accounts final balance sum == 100,000 (zero-sum)');

    // (b) Both score_entries batches balance to 0
    const batchesRes = await pool.query<{
      event_id: string;
      entry_count: number;
      batch_sum: number;
    }>(
      `SELECT
         event_id,
         COUNT(*)::int AS entry_count,
         SUM(amount)::int AS batch_sum
       FROM app.score_entries
       WHERE match_id = $1
       GROUP BY event_id
       ORDER BY MIN(created_at) ASC`,
      [matchId],
    );
    checkEq(batchesRes.rows.length, 2, 'Exactly 2 score_entries batches (Hand 1 and Hand 2) recorded');
    checkEq(batchesRes.rows[0].batch_sum, 0, 'Hand 1 score_entries batch balances to 0');
    checkEq(batchesRes.rows[1].batch_sum, 0, 'Hand 2 score_entries batch balances to 0');
    check(batchesRes.rows[0].entry_count >= 6, 'Hand 1 score_entries batch has riichi + tsumo + pool entries');
    check(batchesRes.rows[1].entry_count >= 6, 'Hand 2 score_entries batch follows §6.3 6-entry ledger pattern');

    // (c) Principals linked (accounts linked to auth_user_id; guests linked to guest_sessions; all 4 in match_members, seat_assignments, member_access_grants, settlement_players)
    const principalIds = [acct1.principalId, acct2.principalId, guest1.principalId, guest2.principalId];
    const pRows = await pool.query<{
      id: string;
      kind: string;
      auth_user_id: string | null;
    }>(`SELECT id, kind, auth_user_id FROM app.principals WHERE id = ANY($1::uuid[])`, [principalIds]);
    checkEq(pRows.rows.length, 4, 'All 4 principals exist in app.principals');

    const userPrincipals = pRows.rows.filter((p) => p.kind === 'user');
    const guestPrincipals = pRows.rows.filter((p) => p.kind === 'guest');
    checkEq(userPrincipals.length, 2, '2 user principals in app.principals');
    check(
      userPrincipals.every((p) => typeof p.auth_user_id === 'string' && p.auth_user_id.length > 0),
      'Both user principals linked via non-null auth_user_id',
    );
    checkEq(guestPrincipals.length, 2, '2 guest principals in app.principals');

    const gsRes = await pool.query<{ cnt: number }>(
      `SELECT COUNT(DISTINCT principal_id)::int AS cnt
       FROM app.guest_sessions
       WHERE principal_id = ANY($1::uuid[]) AND revoked_at IS NULL`,
      [[guest1.principalId, guest2.principalId]],
    );
    checkEq(gsRes.rows[0].cnt, 2, 'Both guest principals linked in app.guest_sessions');

    const magRes = await pool.query<{ cnt: number }>(
      `SELECT COUNT(DISTINCT mag.principal_id)::int AS cnt
       FROM app.member_access_grants mag
       JOIN app.match_members mm ON mm.id = mag.member_id
       WHERE mm.match_id = $1 AND mag.revoked_at IS NULL`,
      [matchId],
    );
    checkEq(magRes.rows[0].cnt, 4, 'All 4 principals have active member_access_grants');

    const spRes = await pool.query<{ cnt: number; total_tenths_sum: number }>(
      `SELECT COUNT(*)::int AS cnt, SUM(total_tenths)::int AS total_tenths_sum
       FROM app.settlement_players
       WHERE settlement_id = $1`,
      [settleConfirm.data.settlementId],
    );
    checkEq(spRes.rows[0].cnt, 4, 'All 4 seats recorded in app.settlement_players');
    checkEq(spRes.rows[0].total_tenths_sum, 0, 'settlement_players total_tenths sum to 0');

    // Verify WebSocket received events
    await wsDone.promise;
    for (const expectedType of [
      'join_approved',
      'check_in',
      'seats_finalized',
      'hand_started',
      'marks_changed',
      'hand_settled',
      'match_finished',
      'settlement_confirmed',
    ]) {
      check(Boolean(wsTypes[expectedType]), `WebSocket broadcasted '${expectedType}' event`);
    }

    ws.close();
    const revokedTicket = await requestJson<{ ticket: string }>(
      `/api/matches/${matchId}/ws-tickets`,
      { method: 'POST', cookie: acct2.cookie, body: {} },
    );
    checkEq(revokedTicket.status, 200, 'Participant can mint a WS ticket before sign-out');
    const signOut = await requestJson('/api/auth/sign-out', {
      method: 'POST', cookie: acct2.cookie, body: {},
    });
    checkEq(signOut.status, 200, 'Participant signs out before using the WS ticket');
    const blockedWs = new WebSocket(`${wsBaseUrl}/ws/matches/${matchId}?ticket=${encodeURIComponent(revokedTicket.data.ticket)}`);
    const closeCode = await new Promise<number>((resolve) => {
      blockedWs.addEventListener('error', () => { /* A rejected upgrade may emit an error before close. */ });
      blockedWs.addEventListener('close', (event) => resolve(event.code));
    });
    checkEq(closeCode, 1008, 'Signed-out WS ticket closes with policy violation 1008');

    return { assertionsPassed };
  } finally {
    await app.close();
  }
}

test('Stage B E2E full match lifecycle and ledger invariants', async () => {
  try {
    const { assertionsPassed } = await runStageBE2E();
    console.log(`E2E assertions passed: ${assertionsPassed}`);
    assert.ok(assertionsPassed >= 60, `Expected at least 60 assertions, got ${assertionsPassed}`);
  } finally {
    await pool.end();
  }
});
