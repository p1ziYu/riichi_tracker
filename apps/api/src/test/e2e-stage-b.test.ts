import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
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
    const inheritedOrigin = await fetch(`${baseUrl}/api/me`, {
      method: 'OPTIONS',
      headers: { origin: 'constructor', 'access-control-request-method': 'GET' },
    });
    checkEq(inheritedOrigin.headers.get('access-control-allow-origin'), null,
      'Prototype property names never pass the CORS allowlist');
    const inheritedAuthOrigin = await requestJson<{ error: string }>('/api/auth/sign-in/anonymous', {
      method: 'POST',
      origin: 'constructor',
      body: {},
    });
    checkEq(inheritedAuthOrigin.status, 403, 'Prototype property names never pass the auth origin allowlist');
    checkEq(inheritedAuthOrigin.data.error, 'invalid_origin', 'Auth origin denial uses the trusted-origin error');
    const blockedPreflight = await fetch(`${baseUrl}/api/me`, {
      method: 'OPTIONS',
      headers: { origin: 'https://attacker.example', 'access-control-request-method': 'POST' },
    });
    checkEq(blockedPreflight.headers.get('access-control-allow-origin'), null,
      'Untrusted web origin does not receive a credentialed CORS grant');
    const processHealth = await requestJson<{ ok: boolean; service: string }>('/health');
    checkEq(processHealth.status, 200, 'Process health endpoint responds without credentials');
    checkEq(processHealth.data.ok, true, 'Process health reports ready');
    const dbHealth = await requestJson<{ ok: boolean; db: boolean }>('/api/health');
    checkEq(dbHealth.status, 200, 'Database health endpoint responds without credentials');
    checkEq(dbHealth.data.db, true, 'Database health SELECT confirms connectivity');
    const oversizedBody = await fetch(`${baseUrl}/api/auth/sign-in/anonymous`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:5173' },
      body: JSON.stringify({ excess: 'x'.repeat(1024 * 1024) }),
    });
    checkEq(oversizedBody.status, 413, 'Oversized JSON receives HTTP 413, not a malformed-JSON response');
    checkEq((await oversizedBody.json() as { error: string }).error, 'payload_too_large',
      'Oversized JSON receives a stable error without parser details');
    const unsupportedBody = await fetch(`${baseUrl}/api/auth/sign-in/anonymous`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-unsupported', origin: 'http://127.0.0.1:5173' },
      body: 'test',
    });
    checkEq(unsupportedBody.status, 415, 'Unsupported content type receives HTTP 415');
    checkEq((await unsupportedBody.json() as { error: string }).error, 'unsupported_media_type',
      'Unsupported content type receives a stable error without parser details');
    const malformedBody = await fetch(`${baseUrl}/api/auth/sign-in/anonymous`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:5173' },
      body: '{"unterminated":',
    });
    checkEq(malformedBody.status, 400, 'Malformed JSON is rejected before auth handler');
    checkEq(await malformedBody.json(), { error: 'invalid_json', message: 'Malformed JSON request body' },
      'Malformed JSON response does not include parser details');

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
    const malformedVersion = await requestJson<{ error: string }>('/api/rulesets/versions/not-a-uuid');
    checkEq(malformedVersion.status, 400, 'Malformed version UUID returns 400 instead of a database error');
    checkEq(malformedVersion.data.error, 'invalid_ruleset_version_id', 'Malformed version has stable error code');
    const privateTemplate = await pool.query<{ id: string }>(
      `INSERT INTO app.ruleset_templates (owner_principal_id, scope, name, player_count, review_status)
       VALUES ($1, 'private', 'Private authorization probe', 4, 'not_applicable')
       RETURNING id`,
      [acct1.principalId],
    );
    const privateVersion = await pool.query<{ id: string }>(
      `INSERT INTO app.ruleset_versions (
         template_id, version, player_count, config, config_hash, config_schema_version, engine_version
       )
       SELECT $1, 1, player_count, config, config_hash, config_schema_version, engine_version
       FROM app.ruleset_versions WHERE id = $2
       RETURNING id`,
      [privateTemplate.rows[0].id, house4p!.versionId],
    );
    const privateVersionId = privateVersion.rows[0].id;
    const ownerTemplates = await requestJson<typeof tplRes.data>('/api/rulesets/templates', { cookie: acct1.cookie });
    const outsiderTemplates = await requestJson<typeof tplRes.data>('/api/rulesets/templates', { cookie: acct2.cookie });
    check(ownerTemplates.data.some((template) => template.versionId === privateVersionId),
      'Owner can list their private ruleset');
    check(!outsiderTemplates.data.some((template) => template.versionId === privateVersionId),
      'Other accounts cannot list a private ruleset');
    const anonymousTemplates = await requestJson<typeof tplRes.data>('/api/rulesets/templates');
    check(!anonymousTemplates.data.some((template) => template.versionId === privateVersionId),
      'Anonymous template list contains no private rulesets');
    const outsiderVersion = await requestJson(`/api/rulesets/versions/${privateVersionId}`, { cookie: acct2.cookie });
    const ownerVersion = await requestJson(`/api/rulesets/versions/${privateVersionId}`, { cookie: acct1.cookie });
    checkEq(outsiderVersion.status, 403, 'Other accounts cannot fetch a private ruleset by UUID');
    checkEq(ownerVersion.status, 200, 'Owner can fetch their private ruleset by UUID');
    const outsiderUse = await requestJson('/api/matches', {
      method: 'POST', cookie: acct2.cookie, body: { rulesetVersionId: privateVersionId },
    });
    checkEq(outsiderUse.status, 403, 'Other accounts cannot create a match from private ruleset UUID');
    const malformedCreateVersion = await requestJson<{ error: string }>('/api/matches', {
      method: 'POST', cookie: acct1.cookie, body: { rulesetVersionId: 'not-a-uuid' },
    });
    checkEq(malformedCreateVersion.status, 400, 'Malformed creation version UUID returns 400');
    checkEq(malformedCreateVersion.data.error, 'invalid_ruleset_version_id', 'Malformed creation has stable error code');
    const rulesOverride = {
      honbaPerPayer: 200,
      notenPenaltyTotal: 2400,
      kiriageMangan: true,
      targetPoints: 26000,
      uma: [15, 5, -5, -15],
      doubleYakuman: true,
    };
    for (const invalid of [
      { rulesOverride: { kiriageMangan: 'true' } },
      { rulesOverride: { targetPoints: 25950 } },
      { rulesOverride: { honbaRon: 350 } },
      { rulesOverride: { uma: [20, 10, -10, -10] } },
      { rulesOverride: { doubleYakuman: true, playerCount: 3 } },
      { rulesOverride: JSON.parse('{"__proto__":{"polluted":true}}') },
      { rulesOverride: JSON.parse('{"constructor":{"prototype":{"polluted":true}}}') },
      { rulesOverride: { honbaPerPayer: -100 } },
      { rulesOverride: { uma: [15, 5, -20] } },
      { rulesOverride: { startingPoints: 1e15 } },
      { rulesOverride: { uma: [1e15, -1e15, 0, 0] } },
    ]) {
      const rejected = await requestJson<{ error: string; message: string }>('/api/matches', {
        method: 'POST', cookie: acct1.cookie,
        body: { rulesetVersionId: house4p!.versionId, ...invalid },
      });
      checkEq(rejected.status, 400, 'Invalid canonical rules override returns HTTP 400');
      checkEq(rejected.data.error, 'invalid_rules_override', 'Override validation has a structured error');
      check(Boolean(rejected.data.message), 'Override validation explains the invalid value');
    }
    const missingBase = await requestJson<{ error: string }>('/api/matches', {
      method: 'POST', cookie: acct1.cookie, body: { rulesOverride },
    });
    checkEq(missingBase.status, 400, 'Rules override cannot be submitted without a selected version');
    const outsiderOverride = await requestJson('/api/matches', {
      method: 'POST', cookie: acct2.cookie,
      body: { rulesetVersionId: privateVersionId, rulesOverride },
    });
    checkEq(outsiderOverride.status, 403, 'Override cannot bypass base ruleset ownership');
    const overrideCreate = await requestJson<{ match: { id: string } }>('/api/matches', {
      method: 'POST', cookie: acct1.cookie, body: { rulesetVersionId: house4p!.versionId, rulesOverride },
    });
    checkEq(overrideCreate.status, 200, 'Owner creates match with per-match rules override');
    const overrideMatch = await pool.query<{
      ruleset_version_id: string; rules_snapshot: Record<string, unknown>; rules_hash: string;
      config: Record<string, unknown>; config_hash: string; scope: string; owner_principal_id: string;
    }>(
      `SELECT m.ruleset_version_id, m.rules_snapshot, m.rules_hash, v.config, v.config_hash,
              t.scope, t.owner_principal_id
       FROM app.matches m
       JOIN app.ruleset_versions v ON v.id = m.ruleset_version_id
       JOIN app.ruleset_templates t ON t.id = v.template_id
       WHERE m.id = $1`,
      [overrideCreate.data.match.id],
    );
    const overridden = overrideMatch.rows[0];
    check(overridden.ruleset_version_id !== house4p!.versionId, 'Custom match binds a new immutable version');
    check(overridden.rules_hash !== verRes.data.configHash, 'Custom rules differ from selected template hash');
    checkEq(overridden.rules_hash, overridden.config_hash, 'Match and immutable version hashes agree');
    checkEq(overridden.rules_snapshot, overridden.config, 'Match snapshot agrees with stored version config');
    checkEq(overridden.rules_snapshot.honbaRon, 600, 'Overriding payer derives consistent ron honba');
    checkEq(overridden.rules_snapshot.notenPenaltyTotal, 2400, 'Overridden draw penalty is canonical');
    checkEq(overridden.rules_snapshot.uma, [15, 5, -5, -15], 'Overridden uma replaces seeded umaTenths');
    checkEq(overridden.scope, 'user', 'Match-only template uses user scope');
    checkEq(overridden.owner_principal_id, acct1.principalId, 'Custom ruleset belongs only to creator');
    const metadata = overridden.rules_snapshot.metadata;
    check(metadata !== null && typeof metadata === 'object' && !Array.isArray(metadata)
      && 'baseRulesetVersionId' in metadata && metadata.baseRulesetVersionId === house4p!.versionId,
    'Custom snapshot retains base provenance');
    const hiddenCustom = await requestJson<typeof tplRes.data>('/api/rulesets/templates', { cookie: acct1.cookie });
    check(!hiddenCustom.data.some((template) => template.versionId === overridden.ruleset_version_id),
      'Match-only version does not appear in ruleset template listing');
    const outsiderCustomTemplates = await requestJson<typeof tplRes.data>('/api/rulesets/templates',
      { cookie: acct2.cookie });
    check(!outsiderCustomTemplates.data.some((template) => template.versionId === overridden.ruleset_version_id),
      'Outsider template listing cannot enumerate match-only version');
    const anonymousCustomTemplates = await requestJson<typeof tplRes.data>('/api/rulesets/templates');
    check(!anonymousCustomTemplates.data.some((template) => template.versionId === overridden.ruleset_version_id),
      'Anonymous template listing cannot enumerate match-only version');
    const outsiderCustomVersion = await requestJson(`/api/rulesets/versions/${overridden.ruleset_version_id}`,
      { cookie: acct2.cookie });
    checkEq(outsiderCustomVersion.status, 403, 'Cross-owner access to custom version is forbidden');
    const outsiderCustomUse = await requestJson('/api/matches', {
      method: 'POST', cookie: acct2.cookie,
      body: { rulesetVersionId: overridden.ruleset_version_id },
    });
    checkEq(outsiderCustomUse.status, 403, 'Cross-owner creation from custom version is forbidden');
    const ownerCustomVersion = await requestJson(`/api/rulesets/versions/${overridden.ruleset_version_id}`,
      { cookie: acct1.cookie });
    checkEq(ownerCustomVersion.status, 200, 'Custom version remains readable by its owner');
    const anonymousCustomVersion = await requestJson(`/api/rulesets/versions/${overridden.ruleset_version_id}`);
    checkEq(anonymousCustomVersion.status, 403, 'Anonymous caller cannot fetch custom version');
    const outsiderCustomMatch = await requestJson(`/api/matches/${overrideCreate.data.match.id}`,
      { cookie: acct2.cookie });
    checkEq(outsiderCustomMatch.status, 403, 'Outsider cannot read custom rules through match detail');
    const outsiderMatches = await requestJson<{ id: string }[]>('/api/matches?mine=1', { cookie: acct2.cookie });
    check(!outsiderMatches.data.some((match) => match.id === overrideCreate.data.match.id),
      'Outsider cannot enumerate custom rules through match list');


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
    const ownerBeforeClaim = await requestJson<{
      match: { rulesHash: string }; seats: { principalId: string | null; status: string }[]; checkedIn: number;
    }>(`/api/matches/${matchId}`, { cookie: acct1.cookie });
    check(ownerBeforeClaim.data.seats.every((seat) => seat.principalId === null),
      'Owner is an active member but has no assigned seat after creation');
    checkEq(ownerBeforeClaim.data.checkedIn, 0, 'Creation does not auto-check-in a seatless owner');
    const ownerMembership = await pool.query<{ role: string; status: string }>(
      'SELECT role, status FROM app.match_members WHERE match_id = $1 AND principal_id = $2',
      [matchId, acct1.principalId],
    );
    checkEq(ownerMembership.rows[0], { role: 'participant', status: 'active' },
      'Unseated owner remains an active participant');
    const ownerClaim = await requestJson<{ seatNo: number; status: string }>(
      `/api/matches/${matchId}/seats/claim`,
      { method: 'POST', cookie: acct1.cookie, body: { seatNo: 0 } },
    );
    checkEq(ownerClaim.status, 200, 'Owner claims a seat without a join request');
    checkEq(ownerClaim.data.status, 'checked_in', 'Owner claim is confirmed and checked in');
    const ownerCheckIn = await pool.query<{ method: string; rules_hash: string; confirmed_by: string }>(
      `SELECT ci.method, ci.rules_hash, sa.confirmed_by FROM app.check_ins ci
       JOIN app.seat_assignments sa ON sa.id = ci.seat_assignment_id
       WHERE ci.match_id = $1 AND sa.seat_no = 0 AND ci.invalidated_at IS NULL`,
      [matchId],
    );
    checkEq(ownerCheckIn.rows[0],
      { method: 'host_confirm', rules_hash: ownerBeforeClaim.data.match.rulesHash,
        confirmed_by: acct1.principalId },
      'Owner assignment is auto-confirmed with a current-rules check-in row');
    const crossOriginTicket = await requestJson<{ error: string }>(`/api/matches/${matchId}/ws-tickets`, {
      method: 'POST', cookie: acct1.cookie, origin: 'https://evil.p1ziyu.com',
    });
    checkEq(crossOriginTicket.status, 403, 'Cross-origin cookie POST cannot mint a WebSocket ticket');
    checkEq(crossOriginTicket.data.error, 'invalid_origin', 'Cross-origin API write uses a stable origin error');
    const crossOriginCreate = await requestJson<{ error: string }>('/api/matches', {
      method: 'POST', cookie: acct1.cookie, origin: 'https://evil.p1ziyu.com',
      body: { rulesetVersionId: house4p!.versionId },
    });
    checkEq(crossOriginCreate.status, 403, 'Cross-origin cookie POST cannot mutate match state');
    const noOriginBearerTicket = await fetch(`${baseUrl}/api/matches/${matchId}/ws-tickets`, {
      method: 'POST', headers: { authorization: `Bearer ${acct1.token}` },
    });
    checkEq(noOriginBearerTicket.status, 200, 'Native bearer POST without Origin remains supported');
    const oversizedTicketBody = await fetch(`${baseUrl}/api/matches/${matchId}/ws-tickets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: acct1.cookie },
      body: JSON.stringify({ excess: 'x'.repeat(1024 * 1024) }),
    });
    checkEq(oversizedTicketBody.status, 413, 'Authenticated ticket POST enforces request body size');
    checkEq((await oversizedTicketBody.json() as { error: string }).error, 'payload_too_large',
      'Ticket POST size denial does not leak parser details');
    const anonymousHead = await fetch(`${baseUrl}/api/matches/${matchId}`, { method: 'HEAD' });
    checkEq(anonymousHead.status, 401, 'Implicit HEAD route preserves GET match authentication');
    const unsupportedPatch = await fetch(`${baseUrl}/api/matches/${matchId}`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${acct1.token}` },
    });
    checkEq(unsupportedPatch.status, 404, 'Unsupported write method does not reach match handlers');

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
    const outsiderTicket = await requestJson<{ error: string }>(`/api/matches/${matchId}/ws-tickets`, {
      method: 'POST', cookie: acct2.cookie,
    });
    checkEq(outsiderTicket.status, 403, 'Non-member cannot mint a match WebSocket ticket');
    checkEq(outsiderTicket.data.error, 'forbidden', 'Non-member ticket denial does not expose ticket material');
    const unboundGuestTicket = await requestJson<{ error: string }>(`/api/matches/${matchId}/ws-tickets`, {
      method: 'POST', cookie: guest1.cookie,
    });
    checkEq(unboundGuestTicket.status, 403, 'Unbound guest cannot subscribe before owner approval');
    checkEq(unboundGuestTicket.data.error, 'forbidden', 'Guest binding denial uses a stable error');
    const injectedTicket = await requestJson<{ error: string; message: string }>(
      `/api/matches/${encodeURIComponent(`${matchId}' OR true --`)}/ws-tickets`,
      { method: 'POST', cookie: acct1.cookie },
    );
    checkEq(injectedTicket.status, 400, 'Invalid SQL-like match id is rejected before querying ticket access');
    checkEq(injectedTicket.data, { error: 'invalid_match_id', message: 'matchId must be a UUID' },
      'Invalid match id response does not expose SQL text or stack');

    const unticketedWs = new WebSocket(`${wsBaseUrl}/ws/matches/${matchId}`);
    const unticketedClose = await new Promise<number>((resolve) => {
      unticketedWs.addEventListener('error', () => {});
      unticketedWs.addEventListener('close', (event) => resolve(event.code));
    });
    checkEq(unticketedClose, 1008, 'A WebSocket without a ticket closes with policy violation');

    // Connect WebSocket as owner to verify all real-time events
    const wsTicketRes = await requestJson<{ ticket: string; expiresAt: string }>(
      `/api/matches/${matchId}/ws-tickets`,
      { method: 'POST', cookie: acct1.cookie, body: {} },
    );
    checkEq(wsTicketRes.status, 200, 'POST /api/matches/:id/ws-tickets returns 200');
    check(Boolean(wsTicketRes.data.ticket), 'WS ticket returned');
    const wrongMatchWs = new WebSocket(
      `${wsBaseUrl}/ws/matches/${aliasCreate.data.match.id}?ticket=${encodeURIComponent(wsTicketRes.data.ticket)}`,
    );
    const wrongMatchClose = await new Promise<number>((resolve) => {
      wrongMatchWs.addEventListener('error', () => {});
      wrongMatchWs.addEventListener('close', (event) => resolve(event.code));
    });
    checkEq(wrongMatchClose, 1008, 'Ticket issued to another match cannot subscribe or consume the correct ticket');

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
    const replayedWs = new WebSocket(`${wsBaseUrl}/ws/matches/${matchId}?ticket=${encodeURIComponent(wsTicketRes.data.ticket)}`);
    const replayedClose = await new Promise<number>((resolve) => {
      replayedWs.addEventListener('error', () => {});
      replayedWs.addEventListener('close', (event) => resolve(event.code));
    });
    checkEq(replayedClose, 1008, 'A consumed WebSocket ticket cannot open a second subscription');

    // 3b. F1 check: unapproved check-in with a valid token must be rejected with 403 {error:'check_in_not_approved'}
    const unapprovedTokRes = await requestJson<{ token: string; expiresAt: string }>(
      `/api/matches/${matchId}/check-in-tokens`,
      { method: 'POST', cookie: acct1.cookie, body: {} },
    );
    checkEq(unapprovedTokRes.status, 200, 'POST check-in-tokens for unapproved probe returns 200');
    const ownerTokenAttempt = await requestJson<{ error: string }>(
      `/api/matches/${matchId}/check-ins`,
      { method: 'POST', cookie: acct1.cookie, body: { token: unapprovedTokRes.data.token } },
    );
    checkEq([ownerTokenAttempt.status, ownerTokenAttempt.data.error], [403, 'owner_auto_check_in'],
      'Owner cannot use the guest token check-in endpoint');
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

    // Guests still require single-use tokens; the owner never consumes one.
    const playersForCheckIn: { session: ClientSession; expectedSeatNo: number; alias?: string }[] = [
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

      const checkIn = () => requestJson<{ seat: { seatNo: number }; grantId: string }>(
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
      const attempts = p.expectedSeatNo === 1
        ? await Promise.all([checkIn(), checkIn()])
        : [await checkIn()];
      const ciRes = attempts.find((attempt) => attempt.status === 200)!;
      if (p.expectedSeatNo === 1) {
        checkEq(attempts.map((attempt) => attempt.status).sort(), [200, 400],
          'Concurrent use of the same check-in token admits exactly one request');
        const activeCheckIns = await pool.query<{ count: number }>(
          `SELECT COUNT(*)::int AS count FROM app.check_ins
           WHERE match_id = $1 AND seat_assignment_id IN (
             SELECT id FROM app.seat_assignments WHERE match_id = $1 AND seat_no = 1
           ) AND invalidated_at IS NULL`,
          [matchId],
        );
        checkEq(activeCheckIns.rows[0].count, 1, 'Check-in race leaves one active seat check-in');
      }
      checkEq(ciRes.status, 200, `POST check-ins for seat ${p.expectedSeatNo} returns 200`);
      checkEq(ciRes.data.seat.seatNo, p.expectedSeatNo, `Checked-in seatNo matches ${p.expectedSeatNo}`);
      check(Boolean(ciRes.data.grantId), `grantId returned for seat ${p.expectedSeatNo}`);

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
      body: { dealerSeatNo: 0 },
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
    for (const revision of ['0x0', '9007199254740992']) {
      const invalidMark = await requestJson<{ error: string }>(
        `/api/matches/${matchId}/hands/${hand1Id}/marks`,
        { method: 'POST', cookie: acct1.cookie, body: { seatNo: 0, riichi: true, expectedMarkRevision: revision } },
      );
      checkEq(invalidMark.status, 400, `Non-decimal or unsafe mark revision ${revision} is rejected`);
      checkEq(invalidMark.data.error, 'invalid_input', 'Invalid mark revision uses a stable error');
      const invalidResult = await requestJson<{ error: string }>(
        `/api/matches/${matchId}/hands/${hand1Id}/results`,
        { method: 'POST', cookie: acct1.cookie, body: { resultInput: { kind: 'ryuukyoku' }, confirmedMarkRevision: revision } },
      );
      checkEq(invalidResult.status, 400, `Non-decimal or unsafe result revision ${revision} is rejected`);
      checkEq(invalidResult.data.error, 'invalid_mark_revision', 'Invalid result revision uses a stable error');
    }
    const overflowingPayments = await requestJson<{ error: string }>(
      `/api/matches/${matchId}/hands/${hand1Id}/preview`,
      {
        method: 'POST', cookie: acct1.cookie,
        body: { resultInput: { kind: 'chombo', manualPayments: { 0: 2_147_483_648, 1: -2_147_483_648 } } },
      },
    );
    checkEq(overflowingPayments.status, 400, 'Manual payments outside SQL ledger integer range fail before persistence');
    checkEq(overflowingPayments.data.error, 'invalid_manual_payments', 'Oversized manual payments return a stable validation error');

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
    const spectatorTicket = await requestJson<{ ticket: string }>(
      `/api/matches/${matchId}/ws-tickets`,
      { method: 'POST', cookie: spectator.cookie, body: {} },
    );
    checkEq(spectatorTicket.status, 200, 'Spectator can subscribe to match events while authorized');
    const spectatorWs = new WebSocket(
      `${wsBaseUrl}/ws/matches/${matchId}?ticket=${encodeURIComponent(spectatorTicket.data.ticket)}`,
    );
    const spectatorOpen = Promise.withResolvers<void>();
    const spectatorFirstEvent = Promise.withResolvers<void>();
    const spectatorClosed = Promise.withResolvers<number>();
    const spectatorEvents: string[] = [];
    spectatorWs.addEventListener('open', () => spectatorOpen.resolve());
    spectatorWs.addEventListener('error', (error) => spectatorOpen.reject(error));
    spectatorWs.addEventListener('message', (event) => {
      const { type } = JSON.parse(String(event.data)) as { type: string };
      spectatorEvents.push(type);
      if (type === 'marks_changed') spectatorFirstEvent.resolve();
    });
    spectatorWs.addEventListener('close', (event) => spectatorClosed.resolve(event.code));
    await spectatorOpen.promise;

    // Mark seat 0 riichi
    const markRequest = {
      method: 'POST',
      cookie: acct1.cookie,
      body: { seatNo: 0, riichi: true, expectedMarkRevision: 0 },
    };
    const concurrentMarks = await Promise.all([
      requestJson<{ markRevision: number; error?: string }>(
        `/api/matches/${matchId}/hands/${hand1Id}/marks`, markRequest,
      ),
      requestJson<{ markRevision: number; error?: string }>(
        `/api/matches/${matchId}/hands/${hand1Id}/marks`, markRequest,
      ),
    ]);
    checkEq(concurrentMarks.map((res) => res.status).sort(), [200, 409],
      'Concurrent marks compare-and-swap permits one mutation');
    checkEq(concurrentMarks.find((res) => res.status === 409)?.data.error,
      'stale_mark_revision', 'Losing concurrent mark reports stale revision');
    const h1Mark = concurrentMarks.find((res) => res.status === 200)!;
    checkEq(h1Mark.status, 200, 'POST marks seat 0 riichi returns 200');
    checkEq(h1Mark.data.markRevision, 1, 'markRevision bumped to 1');
    await spectatorFirstEvent.promise;
    const spectatorSignOut = await requestJson('/api/auth/sign-out', {
      method: 'POST', cookie: spectator.cookie, body: {},
    });
    checkEq(spectatorSignOut.status, 200, 'Spectator signs out while WebSocket remains connected');

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
    for (const contradictingInput of [
      {
        kind: 'ron',
        winners: [{ seatNo: 1, han: 3, fu: 30, dealInSeatNo: 0, isRiichiDeclarationDealIn: false }],
        riichiDeclarationDealInSeatNo: 0,
      },
      {
        kind: 'ron',
        winners: [
          { seatNo: 1, han: 3, fu: 30, dealInSeatNo: 0, isRiichiDeclarationDealIn: true },
          { seatNo: 2, han: 3, fu: 30, dealInSeatNo: 0, isRiichiDeclarationDealIn: false },
        ],
      },
      {
        kind: 'ron',
        isRiichiDeclarationDealIn: false,
        winners: [{ seatNo: 1, han: 3, fu: 30, dealInSeatNo: 0, isRiichiDeclarationDealIn: true }],
      },
    ]) {
      const contradictory = await requestJson<{ error: string }>(
        `/api/matches/${matchId}/hands/${hand1Id}/preview`,
        { method: 'POST', cookie: acct1.cookie, body: { resultInput: contradictingInput } },
      );
      checkEq(contradictory.status, 400, 'Shared ron discard cannot have contradictory riichi declaration flags');
      checkEq(contradictory.data.error, 'invalid_riichi_declaration_deal_in',
        'Contradictory declaration returns a specific validation error');
    }

    const disabledDouble = await requestJson<{ error: string }>(
      `/api/matches/${matchId}/hands/${hand1Id}/preview`,
      {
        method: 'POST',
        cookie: acct1.cookie,
        body: {
          resultInput: {
            kind: 'ron',
            winners: [{ seatNo: 1, han: 13, fu: 30, yakumanCount: 0, doubleYakumanCount: 1, dealInSeatNo: 2 }],
          },
        },
      },
    );
    checkEq(disabledDouble.status, 400, 'Special double yakuman is rejected when ruleset disables it');
    checkEq(disabledDouble.data.error, 'double_yakuman_disabled', 'Disabled special double returns a specific error');

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
    const h1Settlements = await Promise.all([0, 1].map(() => requestJson<{
      perSeat: { seatNo: number; netPoints: number }[];
      nextHand: { dealerSeatNo: number; honba: number; riichiPool: number };
    }>(`/api/matches/${matchId}/hands/${hand1Id}/results`, {
      method: 'POST',
      cookie: acct1.cookie,
      body: { resultInput: h1Input, confirmedMarkRevision: 1, clientEventId: h1ClientEventId },
    })));
    const [h1Result, simultaneousRetry] = h1Settlements;
    checkEq(h1Settlements.map((result) => result.status), [200, 200],
      'Concurrent identical result submissions return two successful responses');
    checkEq(simultaneousRetry.data, h1Result.data,
      'Concurrent identical result submissions return the same original settlement');
    checkEq(h1Result.status, 200, 'POST Hand 1 results returns 200');
    checkEq(
      h1Result.data.perSeat.map((s) => s.netPoints),
      [6000, -2000, -2000, -2000],
      'Hand 1 settled netPoints match preview',
    );
    checkEq(await spectatorClosed.promise, 1008,
      'Sign-out terminates a previously connected socket before subsequent broadcasts');
    checkEq(spectatorEvents, ['marks_changed'],
      'The signed-out socket receives no later hand-settled event');

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
    const postFinishRetry = await requestJson<typeof h1Result.data>(
      `/api/matches/${matchId}/hands/${hand1Id}/results`,
      {
        method: 'POST',
        cookie: acct1.cookie,
        body: { resultInput: h1Input, confirmedMarkRevision: 1, clientEventId: h1ClientEventId },
      },
    );
    checkEq(postFinishRetry.status, 200, 'Identical result retry remains idempotent after match finish');
    checkEq(postFinishRetry.data, h1Result.data, 'Late result retry returns its original committed payload');

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

    // (c) Principals linked to account/guest identities and seated settlement participants.
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
    // A configured special double reaches the engine and survives result persistence.
    const doublePlayer = await registerEmailAccount(`double_${runId}@example.com`, '特殊役满');
    const dealerGuest = await signInAnonymousGuest('dealer-guest');
    const dealerMatch = await requestJson<{ match: { id: string } }>('/api/matches', {
      method: 'POST', cookie: acct1.cookie, body: { config: { playerCount: 3 } },
    });
    checkEq(dealerMatch.status, 200, 'Dealer-selection fixture creates');
    const dealerId = dealerMatch.data.match.id;
    const claimDealer = (seatNo: number) => requestJson<{ seatNo: number; status: string }>(
      `/api/matches/${dealerId}/seats/claim`,
      { method: 'POST', cookie: acct1.cookie, body: { seatNo } },
    );
    const seatTwoClaim = await claimDealer(2);
    checkEq([seatTwoClaim.status, seatTwoClaim.data.seatNo, seatTwoClaim.data.status], [200, 2, 'checked_in'],
      'Owner can claim seat 2 and is immediately confirmed and checked in');
    const firstClaim = await pool.query<{ id: string; rules_hash: string }>(
      `SELECT ci.id, ci.rules_hash FROM app.check_ins ci
       JOIN app.seat_assignments sa ON sa.id = ci.seat_assignment_id
       WHERE ci.match_id = $1 AND sa.seat_no = 2 AND ci.invalidated_at IS NULL`,
      [dealerId],
    );
    checkEq(firstClaim.rows.length, 1, 'Owner seat 2 has an active check-in row without a token');
    checkEq((await claimDealer(0)).status, 200, 'Owner can switch to seat 0 before start');
    const switched = await pool.query<{ id: string; seat_no: number; invalidated: boolean }>(
      `SELECT ci.id, sa.seat_no, ci.invalidated_at IS NOT NULL AS invalidated
       FROM app.check_ins ci JOIN app.seat_assignments sa ON sa.id = ci.seat_assignment_id
       WHERE ci.match_id = $1 ORDER BY ci.confirmed_at, ci.id`,
      [dealerId],
    );
    checkEq(switched.rows.length, 2, 'Seat switch reissues owner check-in rather than retaining the old row');
    checkEq(switched.rows.find((row) => row.id === firstClaim.rows[0].id)?.invalidated, true,
      'Previous owner check-in is invalidated on a seat change');
    checkEq((await claimDealer(2)).status, 200, 'Owner reclaims seat 2 before start');
    const switchedBack = await requestJson<{ seats: { seatNo: number; status: string; principalId: string | null }[]; checkedIn: number }>(
      `/api/matches/${dealerId}`, { cookie: acct1.cookie },
    );
    checkEq(switchedBack.data.seats.map((seat) => seat.status), ['empty', 'empty', 'checked_in'],
      'Owner status and active check-in follow the new seat');
    checkEq(switchedBack.data.checkedIn, 1, 'Only the current owner check-in counts');
    const invalidEmpty = await requestJson<{ error: string }>(`/api/matches/${dealerId}/seats/finalize`, {
      method: 'POST', cookie: acct1.cookie, body: { dealerSeatNo: 0 },
    });
    checkEq([invalidEmpty.status, invalidEmpty.data.error], [400, 'invalid_dealer_seat'],
      'Explicit dealer at an empty seat is rejected with a structured 400');
    for (const [participant, seatNo] of [[acct2, 0], [dealerGuest, 1]] as const) {
      const jr = await requestJson<{ joinRequestId: string }>(`/api/matches/${dealerId}/join-requests`, {
        method: 'POST', cookie: participant.cookie, body: {},
      });
      const approved = await requestJson(`/api/matches/${dealerId}/join-requests/${jr.data.joinRequestId}/approve`, {
        method: 'POST', cookie: acct1.cookie, body: { seatNo },
      });
      checkEq(approved.status, 200, 'Guest seat requires owner approval');
    }
    const invalidUnchecked = await requestJson<{ error: string }>(`/api/matches/${dealerId}/seats/finalize`, {
      method: 'POST', cookie: acct1.cookie, body: { dealerSeatNo: 1 },
    });
    checkEq([invalidUnchecked.status, invalidUnchecked.data.error], [400, 'invalid_dealer_seat'],
      'Explicit dealer at an unchecked guest seat is rejected');
    const accountToken = await requestJson<{ token: string }>(`/api/matches/${dealerId}/check-in-tokens`, {
      method: 'POST', cookie: acct1.cookie, body: {},
    });
    const accountChecked = await requestJson(`/api/matches/${dealerId}/check-ins`, {
      method: 'POST', cookie: acct2.cookie, body: { token: accountToken.data.token },
    });
    checkEq(accountChecked.status, 200, 'Account guest checks in with token');
    const missingGuest = await requestJson<{ error: string }>(`/api/matches/${dealerId}/seats/finalize`, {
      method: 'POST', cookie: acct1.cookie, body: { dealerSeatNo: 2 },
    });
    checkEq([missingGuest.status, missingGuest.data.error], [400, 'incomplete_check_ins'],
      'Owner auto-check-in never bypasses a missing anonymous guest check-in');
    for (const participant of [dealerGuest]) {
      const token = await requestJson<{ token: string }>(`/api/matches/${dealerId}/check-in-tokens`, {
        method: 'POST', cookie: acct1.cookie, body: {},
      });
      const checked = await requestJson(`/api/matches/${dealerId}/check-ins`, {
        method: 'POST', cookie: participant.cookie, body: { token: token.data.token },
      });
      checkEq(checked.status, 200, 'Approved guest checks in with a token');
    }
    const chosen = await requestJson<{ dealerSeatNo: number }>(`/api/matches/${dealerId}/seats/finalize`, {
      method: 'POST', cookie: acct1.cookie, body: { dealerSeatNo: 2 },
    });
    checkEq([chosen.status, chosen.data.dealerSeatNo], [200, 2],
      'Finalize accepts owner seat 2 as East without an owner token');
    const windRows = await pool.query<{ seat_no: number; initial_wind: string }>(
      'SELECT seat_no, initial_wind FROM app.match_seats WHERE match_id = $1 ORDER BY seat_no', [dealerId],
    );
    checkEq(windRows.rows.map((row) => row.initial_wind), ['S', 'W', 'E'],
      'Initial winds rotate from the selected dealer');
    const chosenEvent = await pool.query<{ payload: { dealerSeatNo: number } }>(
      `SELECT payload FROM app.match_events WHERE match_id = $1 AND type = 'seats_finalized'`, [dealerId],
    );
    checkEq(chosenEvent.rows[0].payload.dealerSeatNo, 2, 'Finalization event records chosen dealer');
    const chosenHand = await requestJson<{ hand: { dealerSeatNo: number } }>(`/api/matches/${dealerId}/hands`, {
      method: 'POST', cookie: acct1.cookie, body: {},
    });
    checkEq(chosenHand.data.hand.dealerSeatNo, 2, 'First hand opens with seat 2 as dealer');
    const doubleMatch = await requestJson<{ match: { id: string } }>('/api/matches', {
      method: 'POST',
      cookie: acct1.cookie,
      body: { config: { playerCount: 3, doubleYakuman: true } },
    });
    checkEq(doubleMatch.status, 200, 'A three-player special-double ruleset creates a match');
    const doubleMatchId = doubleMatch.data.match.id;
    const doubleOwnerClaim = await requestJson(`/api/matches/${doubleMatchId}/seats/claim`, {
      method: 'POST', cookie: acct1.cookie, body: { seatNo: 0 },
    });
    checkEq(doubleOwnerClaim.status, 200, 'Special-double owner claims their own seat');
    for (const [participant, seatNo] of [[acct2, 1], [doublePlayer, 2]] as const) {
      const join = await requestJson<{ joinRequestId: string }>(`/api/matches/${doubleMatchId}/join-requests`, {
        method: 'POST', cookie: participant.cookie, body: {},
      });
      checkEq(join.status, 200, 'Double-yakuman match accepts a join request');
      const approve = await requestJson(`/api/matches/${doubleMatchId}/join-requests/${join.data.joinRequestId}/approve`, {
        method: 'POST', cookie: acct1.cookie, body: { seatNo },
      });
      checkEq(approve.status, 200, 'Owner approves a special-double match seat');
    }
    for (const participant of [acct2, doublePlayer]) {
      const tokenResponse = await requestJson<{ token: string }>(`/api/matches/${doubleMatchId}/check-in-tokens`, {
        method: 'POST', cookie: acct1.cookie, body: {},
      });
      checkEq(tokenResponse.status, 200, 'Owner issues a check-in token in special-double match');
      const checked = await requestJson(`/api/matches/${doubleMatchId}/check-ins`, {
        method: 'POST', cookie: participant.cookie, body: { token: tokenResponse.data.token },
      });
      checkEq(checked.status, 200, 'Approved special-double match seat checks in');
    }
    const doubleFinalize = await requestJson(`/api/matches/${doubleMatchId}/seats/finalize`, {
      method: 'POST', cookie: acct1.cookie, body: { dealerSeatNo: 0 },
    });
    checkEq(doubleFinalize.status, 200, 'Special-double match seats finalize');
    const doubleStart = await requestJson<{ hand: { id: string } }>(`/api/matches/${doubleMatchId}/hands`, {
      method: 'POST', cookie: acct1.cookie, body: {},
    });
    checkEq(doubleStart.status, 200, 'Special-double hand opens');
    const doubleHandId = doubleStart.data.hand.id;
    const specialDoubleInput = {
      kind: 'ron',
      winners: [{ seatNo: 1, han: 13, yakumanCount: 0, doubleYakumanCount: 1, dealInSeatNo: 2 }],
    };
    const doublePreview = await requestJson<{ perSeat: { netPoints: number }[] }>(
      `/api/matches/${doubleMatchId}/hands/${doubleHandId}/preview`,
      { method: 'POST', cookie: acct2.cookie, body: { resultInput: specialDoubleInput } },
    );
    checkEq(doublePreview.status, 200, 'Enabled special double yakuman previews successfully');
    checkEq(doublePreview.data.perSeat.map((seat) => seat.netPoints), [0, 64000, -64000],
      'Special double yakuman transfers two yakuman, not one');
    const aliasDoublePreview = await requestJson<{ perSeat: { netPoints: number }[] }>(
      `/api/matches/${doubleMatchId}/hands/${doubleHandId}/preview`,
      {
        method: 'POST',
        cookie: acct2.cookie,
        body: { resultInput: { kind: 'ron', winnerSeatNo: 1, dealInSeatNo: 2, han: 13, doubleYakumanCount: 1 } },
      },
    );
    checkEq(aliasDoublePreview.status, 200, 'Single-winner alias forwards special double yakuman');
    checkEq(aliasDoublePreview.data.perSeat, doublePreview.data.perSeat,
      'Single-winner special double preview matches winner-array input');
    const doubleResult = await requestJson<{ perSeat: { netPoints: number }[] }>(
      `/api/matches/${doubleMatchId}/hands/${doubleHandId}/results`,
      { method: 'POST', cookie: acct2.cookie, body: { resultInput: specialDoubleInput, confirmedMarkRevision: 0 } },
    );
    checkEq(doubleResult.status, 200, 'Enabled special double yakuman settles successfully');
    checkEq(doubleResult.data.perSeat, doublePreview.data.perSeat,
      'Special double settlement matches preview');
    const storedDouble = await pool.query<{ double_count: number; multiplier: number }>(
      `SELECT (hr.input->'winners'->0->>'doubleYakumanCount')::int AS double_count,
              rw.yakuman_count::int AS multiplier
       FROM app.hand_results hr
       JOIN app.result_winners rw ON rw.result_id = hr.id
       WHERE hr.hand_id = $1 AND rw.seat_no = 1`,
      [doubleHandId],
    );
    checkEq(storedDouble.rows[0], { double_count: 1, multiplier: 2 },
      'Persisted result retains special count and total yakuman multiplier');
    const startReadyMatch = async (
      versionId: string, participants: ClientSession[], rulesOverride?: Record<string, unknown>,
      dealerSeatNo: number | null = 0,
    ) => {
      const created = await requestJson<{ match: { id: string } }>('/api/matches', {
        method: 'POST', cookie: acct1.cookie, body: { rulesetVersionId: versionId, ...(rulesOverride ? { rulesOverride } : {}) },
      });
      checkEq(created.status, 200, 'Reference match creates from its ruleset version');
      const id = created.data.match.id;
      const claimed = await requestJson(`/api/matches/${id}/seats/claim`, {
        method: 'POST', cookie: acct1.cookie, body: { seatNo: 0 },
      });
      checkEq(claimed.status, 200, 'Reference owner claims and auto-confirms seat 0');
      for (let seatNo = 1; seatNo < participants.length; seatNo++) {
        const join = await requestJson<{ joinRequestId: string }>(`/api/matches/${id}/join-requests`, {
          method: 'POST', cookie: participants[seatNo].cookie, body: {},
        });
        checkEq(join.status, 200, 'Reference participant requests a seat');
        const approved = await requestJson(`/api/matches/${id}/join-requests/${join.data.joinRequestId}/approve`, {
          method: 'POST', cookie: acct1.cookie, body: { seatNo },
        });
        checkEq(approved.status, 200, 'Reference participant obtains a seat');
      }
      for (const participant of participants.slice(1)) {
        const token = await requestJson<{ token: string }>(`/api/matches/${id}/check-in-tokens`, {
          method: 'POST', cookie: acct1.cookie, body: {},
        });
        checkEq(token.status, 200, 'Reference check-in token issued');
        const checked = await requestJson(`/api/matches/${id}/check-ins`, {
          method: 'POST', cookie: participant.cookie, body: { token: token.data.token },
        });
        checkEq(checked.status, 200, 'Reference participant checked in');
      }
      const finalized = await requestJson(`/api/matches/${id}/seats/finalize`, {
        method: 'POST', cookie: acct1.cookie, body: dealerSeatNo === null ? {} : { dealerSeatNo },
      });
      checkEq(finalized.status, 200, 'Reference seats finalized');
      return id;
    };

    const wrc = tplRes.data.find((template) => template.templateKey === 'reference_4p_competition');
    const tenhou = tplRes.data.find((template) => template.templateKey === 'reference_3p_common');
    check(Boolean(wrc && tenhou), 'Both reference rulesets are available');
    // Guests are bound to one match; use reusable account principals for both reference fixtures.
    const referenceThird = await registerEmailAccount(`reference3_${runId}@example.com`, '参考西家');
    const referenceFourth = await registerEmailAccount(`reference4_${runId}@example.com`, '参考北家');
    const randomMatchId = await startReadyMatch(house4p!.versionId,
      [acct1, acct2, referenceThird, referenceFourth], undefined, null);
    const randomEvent = await pool.query<{ payload: { dealerSeatNo: number } }>(
      `SELECT payload FROM app.match_events WHERE match_id = $1 AND type = 'seats_finalized'`,
      [randomMatchId],
    );
    const randomDealer = randomEvent.rows[0].payload.dealerSeatNo;
    check([0, 1, 2, 3].includes(randomDealer), 'Random dealer recorded in seats_finalized belongs to a seated player');
    const randomHand = await requestJson<{ hand: { dealerSeatNo: number } }>(
      `/api/matches/${randomMatchId}/hands`, { method: 'POST', cookie: acct1.cookie, body: {} },
    );
    checkEq(randomHand.data.hand.dealerSeatNo, randomDealer,
      'Omitted dealer selection persists consistently into the first hand');

    // Isolated match keeps existing lifecycle event assertions unchanged.
    const budgetMatchId = await startReadyMatch(house4p!.versionId,
      [acct1, acct2, referenceThird, referenceFourth]);
    type BudgetSeat = { seatNo: number; isRiichi: boolean;
      riichiChangeUsage: { declares: number; cancels: number } };
    type BudgetHand = { id: string; markRevision: number; seats: BudgetSeat[] };
    const budgetOpen = await requestJson<{ hand: BudgetHand }>(
      `/api/matches/${budgetMatchId}/hands`, { method: 'POST', cookie: acct1.cookie, body: {} },
    );
    checkEq(budgetOpen.status, 200, 'Budget fixture opens its first hand');
    const budgetHandId = budgetOpen.data.hand.id;
    checkEq(budgetOpen.data.hand.seats.map((s) => s.riichiChangeUsage),
      Array.from({ length: 4 }, () => ({ declares: 0, cancels: 0 })),
      'New hand returns zero usage for every seat');
    const budgetPath = `/api/matches/${budgetMatchId}/hands/${budgetHandId}/marks`;
    const changeBudgetMark = (seatNo: number, riichi: boolean, cookie = acct1.cookie) =>
      requestJson<{ markRevision: number; error?: string; message?: string }>(budgetPath, {
        method: 'POST', cookie, body: { seatNo, riichi },
      });
    const firstDeclare = await changeBudgetMark(0, true);
    checkEq(firstDeclare.status, 200, 'First declaration succeeds');
    const sameValueOtherPrincipal = await changeBudgetMark(0, true, acct2.cookie);
    checkEq(sameValueOtherPrincipal.status, 200, 'Same-value write by another principal remains allowed');
    checkEq(sameValueOtherPrincipal.data.markRevision, 2,
      'Same-value write retains existing mark revision behavior');
    const firstCancel = await changeBudgetMark(0, false);
    checkEq(firstCancel.status, 200, 'First cancellation succeeds');
    const secondDeclare = await changeBudgetMark(0, true);
    checkEq(secondDeclare.status, 200, 'Second declaration succeeds');
    const beforeBudgetDenial = await requestJson<{
      match: { version: number }; currentHand: BudgetHand;
    }>(`/api/matches/${budgetMatchId}`, { cookie: acct1.cookie });
    checkEq(beforeBudgetDenial.data.currentHand.seats[0].riichiChangeUsage,
      { declares: 2, cancels: 1 }, 'Event history counts transitions, not same-value events');
    const secondCancel = await changeBudgetMark(0, false);
    checkEq([secondCancel.status, secondCancel.data.error],
      [409, 'riichi_change_budget_exceeded'], 'Second cancellation exceeds the budget');
    check(typeof secondCancel.data.message === 'string', 'Budget denial includes a message');
    const afterBudgetDenial = await requestJson<typeof beforeBudgetDenial.data>(
      `/api/matches/${budgetMatchId}`, { cookie: acct1.cookie },
    );
    checkEq(afterBudgetDenial.data.match.version, beforeBudgetDenial.data.match.version,
      'Rejected cancellation leaves match version unchanged');
    checkEq(afterBudgetDenial.data.currentHand, beforeBudgetDenial.data.currentHand,
      'Rejected cancellation leaves marks, usage and hand revisions unchanged');
    const repeatedDeclaration = await changeBudgetMark(0, true);
    checkEq(repeatedDeclaration.status, 200, 'Same-value declaration at budget is idempotent');
    const afterIdempotent = await requestJson<typeof beforeBudgetDenial.data>(
      `/api/matches/${budgetMatchId}`, { cookie: acct1.cookie },
    );
    checkEq(afterIdempotent.data, beforeBudgetDenial.data,
      'Same-value repeat at budget does not write an event or change version, mark, or usage');
    const [sameStateAtCap, cancelAtCap] = await Promise.all([
      changeBudgetMark(0, true, acct1.cookie),
      changeBudgetMark(0, false, acct2.cookie),
    ]);
    checkEq([sameStateAtCap.status, cancelAtCap.status, cancelAtCap.data.error],
      [200, 409, 'riichi_change_budget_exceeded'],
      'A second principal cannot race an idempotent repeat to exceed the cancellation budget');
    const afterConcurrentDenial = await requestJson<typeof beforeBudgetDenial.data>(
      `/api/matches/${budgetMatchId}`, { cookie: acct1.cookie },
    );
    checkEq(afterConcurrentDenial.data, beforeBudgetDenial.data,
      'Concurrent rejected cancellation and repeat leave history and mark unchanged');
    const concurrentOtherSeat = await Promise.all([
      changeBudgetMark(1, true), changeBudgetMark(1, true, acct2.cookie),
    ]);
    checkEq(concurrentOtherSeat.map((response) => response.status), [200, 200],
      'Concurrent same-state declarations on another seat succeed');
    const budgetAgain = await requestJson<{ hand: BudgetHand }>(
      `/api/matches/${budgetMatchId}/hands`, { method: 'POST', cookie: acct1.cookie, body: {} },
    );
    checkEq(budgetAgain.data.hand.seats.map((s) => s.riichiChangeUsage),
      [{ declares: 2, cancels: 1 }, { declares: 1, cancels: 0 },
        { declares: 0, cancels: 0 }, { declares: 0, cancels: 0 }],
      'Already-open hand returns independent usage for every seat');
    const beforeOppositeWrites = await requestJson<typeof beforeBudgetDenial.data>(
      `/api/matches/${budgetMatchId}`, { cookie: acct1.cookie },
    );
    const oppositeWrites = await Promise.all([
      changeBudgetMark(2, true, acct1.cookie),
      changeBudgetMark(2, false, acct2.cookie),
    ]);
    checkEq(oppositeWrites.map((response) => response.status), [200, 200],
      'Two principals can serialize opposite marks on one fresh seat');
    const afterOppositeWrites = await requestJson<typeof beforeBudgetDenial.data>(
      `/api/matches/${budgetMatchId}`, { cookie: acct1.cookie },
    );
    const oppositeSeat = afterOppositeWrites.data.currentHand.seats[2];
    checkEq(afterOppositeWrites.data.currentHand.markRevision,
      beforeOppositeWrites.data.currentHand.markRevision + 2,
      'Both serialized writes advance the shared revision exactly once');
    checkEq(oppositeSeat.riichiChangeUsage,
      { declares: 1, cancels: oppositeSeat.isRiichi ? 0 : 1 },
      'Opposite-write budget follows committed transition order, not number of requests');
    if (oppositeSeat.isRiichi) {
      checkEq((await changeBudgetMark(2, false)).status, 200,
        'Reset the concurrently marked seat before settling the fixture');
    }
    const beforeLegacy = await requestJson<typeof beforeBudgetDenial.data>(
      `/api/matches/${budgetMatchId}`, { cookie: acct1.cookie },
    );

    // A historical hand with a second cancellation predating this limit is the only
    // reachable state from which a third declaration can be attempted.
    const legacy = await pool.connect();
    try {
      await legacy.query('BEGIN');
      const legacyVersion = await legacy.query<{ version: string }>(
        `SELECT version FROM app.matches WHERE id = $1 FOR UPDATE`, [budgetMatchId],
      );
      const legacyEvent = await legacy.query<{ id: string }>(
        `INSERT INTO app.match_events
           (match_id, seq, hand_id, actor_principal_id, client_event_id, request_hash, type, payload)
         VALUES ($1, $2, $3, $4, $5, $6, 'marks_changed', $7::jsonb)
         RETURNING id`,
        [budgetMatchId, Number(legacyVersion.rows[0].version) + 1,
          budgetHandId, acct1.principalId, randomUUID(),
          createHash('sha256').update(randomUUID()).digest('hex'),
          JSON.stringify({ handId: budgetHandId, seatNo: 0, riichi: false,
            markRevision: beforeLegacy.data.currentHand.markRevision + 1 })],
      );
      await legacy.query(
        `UPDATE app.hand_riichi_marks
         SET marked = false, seat_revision = seat_revision + 1, updated_by = $1, last_event_id = $2
         WHERE hand_id = $3 AND seat_no = 0`,
        [acct1.principalId, legacyEvent.rows[0].id, budgetHandId],
      );
      await legacy.query(`UPDATE app.hands SET mark_revision = mark_revision + 1 WHERE id = $1`, [budgetHandId]);
      await legacy.query(`UPDATE app.matches SET version = version + 1 WHERE id = $1`, [budgetMatchId]);
      await legacy.query('COMMIT');
    } catch (err) {
      await legacy.query('ROLLBACK');
      throw err;
    } finally {
      legacy.release();
    }
    const beforeThirdDeclare = await requestJson<typeof beforeBudgetDenial.data>(
      `/api/matches/${budgetMatchId}`, { cookie: acct1.cookie },
    );
    checkEq(beforeThirdDeclare.data.currentHand.seats[0].riichiChangeUsage,
      { declares: 2, cancels: 2 }, 'Legacy cancellation is counted from append-only history');
    const thirdDeclare = await changeBudgetMark(0, true);
    checkEq([thirdDeclare.status, thirdDeclare.data.error],
      [409, 'riichi_change_budget_exceeded'], 'Third declaration exceeds the budget');
    const afterThirdDeclare = await requestJson<typeof beforeBudgetDenial.data>(
      `/api/matches/${budgetMatchId}`, { cookie: acct1.cookie },
    );
    checkEq(afterThirdDeclare.data, beforeThirdDeclare.data,
      'Rejected declaration leaves match version, marks, usage and hand revisions unchanged');
    const settledBudget = await requestJson(`/api/matches/${budgetMatchId}/hands/${budgetHandId}/results`, {
      method: 'POST', cookie: acct1.cookie,
      body: { resultInput: { kind: 'ryuukyoku', tenpai: [false, true, false, false] },
        confirmedMarkRevision: beforeThirdDeclare.data.currentHand.markRevision },
    });
    checkEq(settledBudget.status, 200, 'Budget fixture settles first hand');
    const settledMark = await changeBudgetMark(0, false, acct2.cookie);
    checkEq([settledMark.status, settledMark.data.error], [409, 'hand_not_open'],
      'Settlement closes the marks endpoint even for a different principal');
    const nextBudget = await requestJson<{ hand: BudgetHand }>(
      `/api/matches/${budgetMatchId}/hands`, { method: 'POST', cookie: acct1.cookie, body: {} },
    );
    checkEq(nextBudget.status, 200, 'Budget fixture opens next hand');
    checkEq(nextBudget.data.hand.seats.map((s) => s.riichiChangeUsage),
      Array.from({ length: 4 }, () => ({ declares: 0, cancels: 0 })),
      'Next hand resets all seat transition budgets');
    const nextBudgetGet = await requestJson<{ currentHand: BudgetHand }>(
      `/api/matches/${budgetMatchId}`, { cookie: acct1.cookie },
    );
    checkEq(nextBudgetGet.data.currentHand.seats.map((s) => s.riichiChangeUsage),
      Array.from({ length: 4 }, () => ({ declares: 0, cancels: 0 })),
      'GET currentHand resets all seats on the next hand');
    const nextDeclare = await requestJson<{ markRevision: number }>(
      `/api/matches/${budgetMatchId}/hands/${nextBudget.data.hand.id}/marks`, {
        method: 'POST', cookie: acct1.cookie, body: { seatNo: 0, riichi: true },
      });
    checkEq(nextDeclare.status, 200, 'Seat can declare anew in the next hand');
    const voidMatchId = await startReadyMatch(house4p!.versionId,
      [acct1, acct2, referenceThird, referenceFourth], { targetPoints: 25000 });
    const voidHand = await requestJson<{ hand: BudgetHand }>(
      `/api/matches/${voidMatchId}/hands`, { method: 'POST', cookie: acct1.cookie, body: {} },
    );
    checkEq(voidHand.status, 200, 'Voided-hand fixture starts at the target score');
    const voidPath = `/api/matches/${voidMatchId}/hands/${voidHand.data.hand.id}/marks`;
    const markedBeforeVoid = await requestJson<{ markRevision: number }>(voidPath, {
      method: 'POST', cookie: acct1.cookie, body: { seatNo: 0, riichi: true },
    });
    checkEq(markedBeforeVoid.status, 200, 'An open hand accepts a mark before being voided');
    const finishedWithOpenHand = await requestJson<{ finished: boolean }>(`/api/matches/${voidMatchId}/finish`, {
      method: 'POST', cookie: acct1.cookie, body: {},
    });
    checkEq([finishedWithOpenHand.status, finishedWithOpenHand.data.finished], [200, true],
      'Finishing a target-reached match voids its open hand');
    const voidSnapshot = await requestJson<typeof beforeBudgetDenial.data>(
      `/api/matches/${voidMatchId}`, { cookie: acct1.cookie },
    );
    checkEq(voidSnapshot.data.currentHand.seats[0].riichiChangeUsage,
      { declares: 1, cancels: 0 }, 'Voiding preserves original hand transition history');
    const markVoided = await requestJson<{ error: string }>(voidPath, {
      method: 'POST', cookie: acct2.cookie, body: { seatNo: 0, riichi: false },
    });
    checkEq([markVoided.status, markVoided.data.error], [409, 'hand_not_open'],
      'A second principal cannot cancel a mark on a voided hand');
    const settleVoided = await requestJson<{ error: string }>(
      `/api/matches/${voidMatchId}/hands/${voidHand.data.hand.id}/results`, {
        method: 'POST', cookie: acct1.cookie,
        body: { resultInput: { kind: 'ryuukyoku', tenpai: [true, false, false, false] },
          confirmedMarkRevision: markedBeforeVoid.data.markRevision },
      },
    );
    checkEq([settleVoided.status, settleVoided.data.error], [409, 'match_not_active'],
      'Result submission cannot reopen a voided hand via the alternate endpoint');
    const reopenVoided = await requestJson<{ error: string }>(`/api/matches/${voidMatchId}/hands`, {
      method: 'POST', cookie: acct1.cookie, body: {},
    });
    checkEq([reopenVoided.status, reopenVoided.data.error], [409, 'match_not_active'],
      'Opening hands does not reopen a voided hand in a finished match');
    const afterVoidProbes = await requestJson<typeof beforeBudgetDenial.data>(
      `/api/matches/${voidMatchId}`, { cookie: acct1.cookie },
    );
    checkEq(afterVoidProbes.data, voidSnapshot.data,
      'Denied mark and settlement leave voided marks, usage and match version intact');

    const customId = await startReadyMatch(overridden.ruleset_version_id,
      [acct1, acct2, referenceThird, referenceFourth]);
    const customMine = await requestJson<{ id: string; rulesSnapshot: Record<string, unknown> }[]>(
      '/api/matches?mine=1', { cookie: acct1.cookie },
    );
    checkEq(customMine.data.find((m) => m.id === customId)?.rulesSnapshot.kiriageMangan, true,
      'Match list exposes effective custom snapshot');
    const earlyCustom = await requestJson<{ error: string }>(`/api/matches/${customId}/finish`, {
      method: 'POST', cookie: acct1.cookie, body: {},
    });
    checkEq(earlyCustom.status, 409, 'Target policy cannot finish below target without a bust');
    checkEq(earlyCustom.data.error, 'target_not_reached', 'Premature finish has policy-specific error');
    const earlyCustomPreview = await requestJson<{ terminalTenths: number[] }>(
      `/api/matches/${customId}/settlement/preview`, { cookie: acct1.cookie },
    );
    checkEq(earlyCustomPreview.data.terminalTenths, [], 'Target policy preview is unfinished below target');
    const customHand = await requestJson<{ hand: { id: string } }>(
      `/api/matches/${customId}/hands`, { method: 'POST', cookie: acct1.cookie, body: {} },
    );
    checkEq(customHand.status, 200, 'Custom match opens a hand');
    const customResult = await requestJson<{ perSeat: { seatNo: number; netPoints: number }[] }>(
      `/api/matches/${customId}/hands/${customHand.data.hand.id}/results`, {
        method: 'POST', cookie: acct1.cookie,
        body: { resultInput: { kind: 'ron',
          winners: [{ seatNo: 0, han: 4, fu: 30, dealInSeatNo: 1 }] }, confirmedMarkRevision: 0 },
      },
    );
    checkEq(customResult.status, 200, 'Custom match settles the first hand');
    checkEq(customResult.data.perSeat.map((s) => s.netPoints), [12000, -12000, 0, 0],
      'Kiriage override applies mangan dealer ron instead of 11,600 base payment');
    const customFinish = await requestJson<{ finished: boolean }>(`/api/matches/${customId}/finish`, {
      method: 'POST', cookie: acct1.cookie, body: {},
    });
    checkEq(customFinish.status, 200, 'Target policy permits early finish once target is reached');
    checkEq(customFinish.data.finished, true, 'Custom target match is finished');
    const customSettlement = await requestJson<{ terminalTenths: number[] }>(
      `/api/matches/${customId}/settlement/preview`, { cookie: acct1.cookie },
    );
    checkEq(customSettlement.data.terminalTenths.length, 4, 'Custom terminal preview uses effective rules');
    const wrcCustomId = await startReadyMatch(
      wrc!.versionId, [acct1, acct2, referenceThird, referenceFourth],
      { multiRon: 'double_ron', kiriageMangan: false, uma: [16, 4, -4, -16] },
    );
    const wrcCustomMatch = await requestJson<{ match: {
      rulesSnapshot: Record<string, unknown>; rulesetVersionId: string;
    } }>(`/api/matches/${wrcCustomId}`, { cookie: acct1.cookie });
    checkEq(wrcCustomMatch.data.match.rulesSnapshot.multiRon, 'double_ron',
      'WRC custom snapshot replaces head-bump rule');
    checkEq(wrcCustomMatch.data.match.rulesSnapshot.kiriageMangan, false,
      'WRC custom snapshot disables kiriage');
    checkEq(wrcCustomMatch.data.match.rulesSnapshot.uma, [16, 4, -4, -16],
      'WRC custom snapshot retains zero-sum custom uma');
    check(wrcCustomMatch.data.match.rulesetVersionId !== wrc!.versionId,
      'WRC custom match binds a distinct private version');
    const wrcCustomHand = await requestJson<{ hand: { id: string } }>(
      `/api/matches/${wrcCustomId}/hands`, { method: 'POST', cookie: acct1.cookie, body: {} },
    );
    checkEq(wrcCustomHand.status, 200, 'WRC custom match opens a hand');
    const wrcCustomResult = await requestJson<{ perSeat: { seatNo: number; netPoints: number }[] }>(
      `/api/matches/${wrcCustomId}/hands/${wrcCustomHand.data.hand.id}/results`, {
        method: 'POST', cookie: acct1.cookie,
        body: { resultInput: { kind: 'ron', winners: [
          { seatNo: 1, han: 4, fu: 30, dealInSeatNo: 3 },
          { seatNo: 2, han: 4, fu: 30, dealInSeatNo: 3 },
        ] }, confirmedMarkRevision: 0 },
      },
    );
    checkEq(wrcCustomResult.status, 200, 'WRC override settles both ron winners');
    checkEq(wrcCustomResult.data.perSeat.map((s) => s.netPoints), [0, 7700, 7700, -15400],
      'Double ron pays both winners and 4 han 30 fu rounds to 7700 without kiriage');

    const wrcId = await startReadyMatch(wrc!.versionId, [acct1, acct2, referenceThird, referenceFourth]);
    const houseLowId = await startReadyMatch(house4p!.versionId, [acct1, acct2, referenceThird, referenceFourth]);
    for (const [id, start, other] of [[wrcId, 62500, -2500], [houseLowId, 500, 49500]] as const) {
      const changed = await pool.query(
        `UPDATE app.score_accounts SET opening_balance = CASE seat_no WHEN 0 THEN $2 WHEN 1 THEN $3 ELSE opening_balance END
         WHERE match_id = $1 AND kind = 'seat' AND seat_no IN (0, 1)`,
        [id, start, other],
      );
      checkEq(changed.rowCount, 2, 'Low-point fixture preserves the total opening balance');
    }
    const houseLowHand = await requestJson<{ hand: { id: string } }>(`/api/matches/${houseLowId}/hands`, {
      method: 'POST', cookie: acct1.cookie, body: {},
    });
    checkEq(houseLowHand.status, 200, 'House low-point hand opens');
    const houseLowMark = await requestJson<{ error: string }>(
      `/api/matches/${houseLowId}/hands/${houseLowHand.data.hand.id}/marks`,
      { method: 'POST', cookie: acct1.cookie, body: { seatNo: 0, riichi: true } },
    );
    checkEq(houseLowMark.status, 400, 'House rules deny a 500-point riichi declaration');
    checkEq(houseLowMark.data.error, 'insufficient_points_for_riichi', 'House low-point denial uses the admission guard');

    const earlyFinish = await requestJson<{ error: string }>(`/api/matches/${wrcId}/finish`, {
      method: 'POST', cookie: acct1.cookie, body: {},
    });
    checkEq(earlyFinish.status, 409, 'WRC cannot finish before South 4 completes');
    checkEq(earlyFinish.data.error, 'final_round_incomplete', 'WRC finish enforces fixed South 4');
    for (let handIndex = 0; handIndex < 9; handIndex++) {
      const opened = await requestJson<{ hand: { id: string; roundWind: string; roundNumber: number } }>(
        `/api/matches/${wrcId}/hands`, { method: 'POST', cookie: acct1.cookie, body: {} },
      );
      checkEq(opened.status, 200, `WRC hand ${handIndex + 1} opens`);
      checkEq([opened.data.hand.roundWind, opened.data.hand.roundNumber],
        [handIndex < 4 ? 'E' : 'S', handIndex === 8 ? 4 : handIndex % 4 + 1], 'WRC hand follows East/South dealer rotation');
      if (handIndex < 2) {
        const mark = await requestJson<{ markRevision: number }>(
          `/api/matches/${wrcId}/hands/${opened.data.hand.id}/marks`,
          { method: 'POST', cookie: acct1.cookie, body: { seatNo: handIndex === 0 ? 1 : 0, riichi: true } },
        );
        checkEq(mark.status, 200, 'WRC low-point and normal riichi declarations are admitted');
      }
      const settled = await requestJson<{ nextHand: { roundWind: string; roundNumber: number } }>(
        `/api/matches/${wrcId}/hands/${opened.data.hand.id}/results`,
        { method: 'POST', cookie: acct1.cookie,
          body: { resultInput: { kind: 'ryuukyoku', tenpai: handIndex === 0
            ? [false, true, false, false] : handIndex === 1
              ? [true, false, false, false] : handIndex === 7
                ? [false, false, false, true] : [false, false, false, false] },
            confirmedMarkRevision: handIndex < 2 ? 1 : 0 } },
      );
      checkEq(settled.status, 200, 'WRC draw settles');
      if (handIndex === 0) {
        const negative = await pool.query<{ balance: number }>(
          `SELECT (a.opening_balance + COALESCE(SUM(e.amount), 0))::int AS balance
           FROM app.score_accounts a LEFT JOIN app.score_entries e ON e.account_id = a.id
           WHERE a.match_id = $1 AND a.kind = 'seat' AND a.seat_no = 1
           GROUP BY a.id, a.opening_balance`, [wrcId],
        );
        checkEq(negative.rows[0].balance, -500, 'WRC riichi ledger permits negative points and match continuation');
        const reset = await pool.query(
          `UPDATE app.score_accounts SET opening_balance = CASE seat_no WHEN 0 THEN 30000 WHEN 1 THEN 30000 END
           WHERE match_id = $1 AND kind = 'seat' AND seat_no IN (0, 1)`, [wrcId],
        );
        checkEq(reset.rowCount, 2, 'Balanced fixture reset prepares tied WRC final standings');
      }
      if (handIndex === 6) {
        const premature = await requestJson<{ error: string }>(`/api/matches/${wrcId}/finish`, {
          method: 'POST', cookie: acct1.cookie, body: {},
        });
        checkEq(premature.status, 409, 'WRC cannot finish during South 4 before dealer rotation');
      }
      if (handIndex === 7) {
        checkEq(settled.data.nextHand.roundWind, 'S', 'S4 dealer tenpai repeats instead of agari-yame');
        const repeatFinish = await requestJson<{ error: string }>(`/api/matches/${wrcId}/finish`, {
          method: 'POST', cookie: acct1.cookie, body: {},
        });
        checkEq(repeatFinish.status, 409, 'WRC top dealer cannot finish during an S4 repeat');
      }
      if (handIndex === 8) checkEq(settled.data.nextHand.roundWind, 'W', 'South 4 concludes on West rotation');
    }
    const pastLast = await requestJson<{ error: string }>(`/api/matches/${wrcId}/hands`, {
      method: 'POST', cookie: acct1.cookie, body: {},
    });
    checkEq(pastLast.status, 409, 'WRC cannot open West 1 after South 4 completes');
    const wrcFinish = await requestJson<{
      provisionalRankings: { seatNo: number; rank: number; points: number }[];
    }>(`/api/matches/${wrcId}/finish`, { method: 'POST', cookie: acct1.cookie, body: {} });
    checkEq(wrcFinish.status, 200, 'WRC finish succeeds after completed South 4');
    checkEq(wrcFinish.data.provisionalRankings.map((entry) => [entry.seatNo, entry.rank, entry.points]),
      [[3, 1, 31000], [0, 2, 30000], [1, 2, 30000], [2, 4, 27000]],
      'WRC leaves pool unallocated and exposes shared standings ranks');
    const poolLeft = await pool.query<{ balance: number }>(
      `SELECT (a.opening_balance + COALESCE(SUM(e.amount), 0))::int AS balance
       FROM app.score_accounts a LEFT JOIN app.score_entries e ON e.account_id = a.id
       WHERE a.match_id = $1 AND a.kind = 'riichi_pool' GROUP BY a.id, a.opening_balance`, [wrcId],
    );
    checkEq(poolLeft.rows[0].balance, 2000, 'Unallocated WRC pool remains on the ledger after finish');
    const wrcPreview = await requestJson<{ terminalTenths: number[]; standings: { seatNo: number; umaTenths: number }[] }>(
      `/api/matches/${wrcId}/settlement/preview`, { cookie: acct1.cookie },
    );
    checkEq(wrcPreview.status, 200, 'WRC terminal settlement previews');
    checkEq(wrcPreview.data.standings.map((s) => [s.seatNo, s.umaTenths]),
      [[3, 150], [0, 0], [1, 0], [2, -150]], 'WRC tied positions split their combined uma');
    checkEq(wrcPreview.data.terminalTenths.reduce((sum, amount) => sum + amount, 0), -20,
      'Unallocated 2,000-point pool is excluded from player terminal totals');
    const wrcConfirm = await requestJson<{ settlementId: string }>(`/api/matches/${wrcId}/settlement/confirm`, {
      method: 'POST', cookie: acct1.cookie, body: {},
    });
    checkEq(wrcConfirm.status, 200, 'WRC terminal settlement confirms with a retained pool');

    const tenhouId = await startReadyMatch(tenhou!.versionId, [acct1, acct2, doublePlayer]);
    const nagashiHand = await requestJson<{ hand: { id: string } }>(`/api/matches/${tenhouId}/hands`, {
      method: 'POST', cookie: acct1.cookie, body: {},
    });
    checkEq(nagashiHand.status, 200, 'Tenhou nagashi hand opens');
    const nagashiPath = `/api/matches/${tenhouId}/hands/${nagashiHand.data.hand.id}`;
    const eligibleNagashi = {
      kind: 'nagashi_mangan',
      winners: [{ seatNo: 1, han: 5, fu: 30 }],
      tenpai: [false, true, false],
      nagashiEligibility: [{ seatNo: 1, discards: [{ tile: '1p', called: false }, { tile: '7z', called: false }] }],
    };
    for (const [variant, description] of [
      [{ ...eligibleNagashi, nagashiEligibility: undefined }, 'missing attestation'],
      [{ ...eligibleNagashi, nagashiEligibility: [{ seatNo: 1, discards: [{ tile: '2p', called: false }] }] }, 'middle tile'],
      [{ ...eligibleNagashi, nagashiEligibility: [{ seatNo: 1, discards: [{ tile: '1p', called: true }] }] }, 'called discard'],
      [{ ...eligibleNagashi, nagashiEligibility: [{ seatNo: 1, discards: [{ tile: '1p', called: false }], eligible: true }] }, 'forged eligibility flag'],
      [{ ...eligibleNagashi, winners: [{ seatNo: 1, eligible: true }] }, 'forged winner field'],
    ] as const) {
      const invalid = await requestJson<{ error: string }>(`${nagashiPath}/preview`, {
        method: 'POST', cookie: acct1.cookie, body: { resultInput: variant },
      });
      checkEq(invalid.status, 400, `Tenhou nagashi rejects ${description}`);
      checkEq(invalid.data.error, 'invalid_nagashi_eligibility', 'Nagashi attestation reports a stable error');
    }
    const nagashiPreview = await requestJson<{ perSeat: { netPoints: number }[] }>(`${nagashiPath}/preview`, {
      method: 'POST', cookie: acct1.cookie, body: { resultInput: eligibleNagashi },
    });
    checkEq(nagashiPreview.status, 200, 'Attested Tenhou nagashi previews');
    checkEq(nagashiPreview.data.perSeat.map((seat) => seat.netPoints), [-4000, 6000, -2000],
      'Nagashi replaces noten settlement with a single tsumo-mangan payment');
    const nagashiResult = await requestJson<{ perSeat: { netPoints: number }[] }>(`${nagashiPath}/results`, {
      method: 'POST', cookie: acct1.cookie, body: { resultInput: eligibleNagashi, confirmedMarkRevision: 0 },
    });
    checkEq(nagashiResult.status, 200, 'Attested Tenhou nagashi settles');
    checkEq(nagashiResult.data.perSeat, nagashiPreview.data.perSeat, 'Nagashi settlement equals preview');
    const savedNagashi = await pool.query<{ eligibility: unknown }>(
      `SELECT input->'nagashiEligibility' AS eligibility FROM app.hand_results WHERE hand_id = $1`, [nagashiHand.data.hand.id],
    );
    checkEq(savedNagashi.rows[0].eligibility, eligibleNagashi.nagashiEligibility,
      'Complete attested discard history persists with the result');

    const tenhouCapId = await startReadyMatch(tenhou!.versionId, [acct1, acct2, doublePlayer]);
    const manualTenhouFinish = await requestJson<{ error: string }>(`/api/matches/${tenhouCapId}/finish`, {
      method: 'POST', cookie: acct1.cookie, body: {},
    });
    checkEq(manualTenhouFinish.status, 409, 'Tenhou reference cannot bypass its automatic end by manual finish');
    checkEq(manualTenhouFinish.data.error, 'automatic_end_required', 'Tenhou requires automatic round completion');
    for (let handIndex = 0; handIndex < 9; handIndex++) {
      const opened = await requestJson<{ hand: { id: string; roundWind: string; roundNumber: number } }>(
        `/api/matches/${tenhouCapId}/hands`, { method: 'POST', cookie: acct1.cookie, body: {} },
      );
      checkEq(opened.status, 200, 'Tenhou cap fixture opens the next hand');
      checkEq([opened.data.hand.roundWind, opened.data.hand.roundNumber],
        [handIndex < 3 ? 'E' : handIndex < 6 ? 'S' : 'W', handIndex % 3 + 1],
        'Tenhou rotates through East, South, and West three-player rounds');
      const result = await requestJson<{ nextHand: { roundWind: string } }>(
        `/api/matches/${tenhouCapId}/hands/${opened.data.hand.id}/results`,
        { method: 'POST', cookie: acct1.cookie,
          body: { resultInput: { kind: 'ryuukyoku', tenpai: [false, false, false] }, confirmedMarkRevision: 0 } },
      );
      checkEq(result.status, 200, 'Tenhou no-tenpai draw settles');
      if (handIndex === 5) checkEq(result.data.nextHand.roundWind, 'W',
        'Sanma extends to West when nobody reaches the configured candidate target');
    }
    const cappedMatch = await requestJson<{ match: { status: string } }>(
      `/api/matches/${tenhouCapId}`, { cookie: acct1.cookie },
    );
    checkEq(cappedMatch.data.match.status, 'finished', 'Tenhou West 3 cap finishes automatically');
    const cappedFinishEvent = await pool.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM app.match_events WHERE match_id = $1 AND type = 'match_finished'`,
      [tenhouCapId],
    );
    checkEq(cappedFinishEvent.rows[0].count, 1, 'Automatic end emits exactly one match_finished event');
    const beyondCap = await requestJson<{ error: string }>(`/api/matches/${tenhouCapId}/hands`, {
      method: 'POST', cookie: acct1.cookie, body: {},
    });
    checkEq(beyondCap.status, 409, 'No hand may open after the Tenhou West 3 cap');

    const tenhouLastDealerId = await startReadyMatch(tenhou!.versionId, [acct1, acct2, doublePlayer]);
    for (let handIndex = 0; handIndex < 6; handIndex++) {
      const opened = await requestJson<{ hand: { id: string } }>(
        `/api/matches/${tenhouLastDealerId}/hands`, { method: 'POST', cookie: acct1.cookie, body: {} },
      );
      checkEq(opened.status, 200, 'Tenhou last-dealer fixture opens a hand');
      const result = await requestJson(`/api/matches/${tenhouLastDealerId}/hands/${opened.data.hand.id}/results`, {
        method: 'POST', cookie: acct1.cookie,
        body: { resultInput: { kind: 'ryuukyoku', tenpai: handIndex === 5
          ? [false, false, true] : [false, false, false] }, confirmedMarkRevision: 0 },
      });
      checkEq(result.status, 200, 'Tenhou last-dealer fixture settles a draw');
    }
    const lastDealerMatch = await requestJson<{ match: { status: string } }>(
      `/api/matches/${tenhouLastDealerId}`, { cookie: acct1.cookie },
    );
    checkEq(lastDealerMatch.data.match.status, 'finished',
      'Tenhou automatically stops after a leading South 3 dealer is tenpai');
    const lastDealerHands = await pool.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM app.hands WHERE match_id = $1 AND state = 'settled'`,
      [tenhouLastDealerId],
    );
    checkEq(lastDealerHands.rows[0].count, 6, 'Last-dealer stop does not open West 1');

    const expiryProbe = await registerEmailAccount(`expiry_${runId}@example.com`, '会话过期');
    const liveBearer = await requestJson('/api/me', { token: expiryProbe.token });
    checkEq(liveBearer.status, 200, 'Bearer-only session authenticates before expiration');
    const bearerOverCookie = await requestJson<{ principal: { id: string } }>('/api/me', {
      token: acct2.token, cookie: acct1.cookie,
    });
    checkEq(bearerOverCookie.status, 200, 'A valid bearer takes precedence over another account cookie');
    checkEq(bearerOverCookie.data.principal.id, acct2.principalId,
      'Combined credentials resolve to the bearer principal');
    const invalidBearerWithCookie = await requestJson('/api/me', {
      token: `${expiryProbe.token}tampered`, cookie: acct1.cookie,
    });
    checkEq(invalidBearerWithCookie.status, 401,
      'A malformed bearer credential cannot fall back to another account cookie');
    const emptyBearerWithCookie = await fetch(`${baseUrl}/api/me`, {
      headers: { authorization: 'Bearer', cookie: acct1.cookie },
    });
    checkEq(emptyBearerWithCookie.status, 401,
      'An empty bearer credential cannot fall back to another account cookie');
    const expiryUpdate = await pool.query(
      `UPDATE public."session" SET "expiresAt" = now() - interval '1 minute'
       WHERE "token" = $1`,
      [expiryProbe.token],
    );
    checkEq(expiryUpdate.rowCount, 1, 'Expiration probe modifies exactly its own session');
    const expiredBearer = await requestJson('/api/me', { token: expiryProbe.token });
    const expiredCookie = await requestJson('/api/me', { cookie: expiryProbe.cookie });
    checkEq(expiredBearer.status, 401, 'Expired bearer session no longer authenticates');
    checkEq(expiredCookie.status, 401, 'Expired cookie session no longer authenticates');
    const expiredBearerWithCookie = await requestJson('/api/me', {
      token: expiryProbe.token, cookie: acct1.cookie,
    });
    checkEq(expiredBearerWithCookie.status, 401,
      'An expired bearer cannot silently fall back to another valid cookie');

    const expiringTicket = await requestJson<{ ticket: string }>(`/api/matches/${matchId}/ws-tickets`, {
      method: 'POST', cookie: acct1.cookie, body: {},
    });
    checkEq(expiringTicket.status, 200, 'Owner mints a WebSocket ticket to test expiry');
    const expiringHash = createHash('sha256').update(expiringTicket.data.ticket).digest('hex');
    await pool.query(`UPDATE app.ws_tickets SET expires_at = now() - interval '1 second' WHERE token_hash = $1`, [expiringHash]);
    const expiredWs = new WebSocket(
      `${wsBaseUrl}/ws/matches/${matchId}?ticket=${encodeURIComponent(expiringTicket.data.ticket)}`,
    );
    const expiredWsCode = await new Promise<number>((resolve) => {
      expiredWs.addEventListener('error', () => {});
      expiredWs.addEventListener('close', (event) => resolve(event.code));
    });
    checkEq(expiredWsCode, 1008, 'Expired WebSocket ticket cannot open a subscription');

    const revokedTicket = await requestJson<{ ticket: string }>(
      `/api/matches/${matchId}/ws-tickets`,
      { method: 'POST', cookie: acct2.cookie, body: {} },
    );
    checkEq(revokedTicket.status, 200, 'Participant can mint a WS ticket before sign-out');
    const signOut = await requestJson('/api/auth/sign-out', {
      method: 'POST', cookie: acct2.cookie, body: {},
    });
    checkEq(signOut.status, 200, 'Participant signs out before using the WS ticket');
    const signedOutBearer = await requestJson('/api/me', { token: acct2.token });
    checkEq(signedOutBearer.status, 401, 'Signing out a cookie revokes its bearer token too');
    const revokedBearerWithCookie = await requestJson('/api/me', {
      token: acct2.token, cookie: acct1.cookie,
    });
    checkEq(revokedBearerWithCookie.status, 401,
      'A revoked bearer cannot silently fall back to another valid cookie');
    const blockedWs = new WebSocket(`${wsBaseUrl}/ws/matches/${matchId}?ticket=${encodeURIComponent(revokedTicket.data.ticket)}`);
    const closeCode = await new Promise<number>((resolve) => {
      blockedWs.addEventListener('error', () => { /* A rejected upgrade may emit an error before close. */ });
      blockedWs.addEventListener('close', (event) => resolve(event.code));
    });
    checkEq(closeCode, 1008, 'Signed-out WS ticket closes with policy violation 1008');

    // --- Stage B Part 1: History Delete, Hide, Leave, and WebSocket room_deleted ---
    const strangerAcct = await registerEmailAccount(`stranger_${runId}@example.com`, '局外人');

    // 1. DELETE finished match -> 409 match_not_deletable
    const delFinished = await requestJson<{ error: string }>(`/api/matches/${matchId}`, {
      method: 'DELETE',
      cookie: acct1.cookie,
    });
    checkEq([delFinished.status, delFinished.data.error], [409, 'match_not_deletable'],
      'Host cannot delete a finished match');

    // 2. Hide / unhide on finished match
    const strangerHide = await requestJson<{ error: string }>(`/api/matches/${matchId}/hide`, {
      method: 'POST',
      cookie: strangerAcct.cookie,
    });
    checkEq(strangerHide.status, 403, 'Non-participant cannot hide match');

    const hideRes = await requestJson<{ hidden: boolean }>(`/api/matches/${matchId}/hide`, {
      method: 'POST',
      cookie: acct1.cookie,
    });
    checkEq([hideRes.status, hideRes.data.hidden], [200, true], 'Participant hides finished match');
    const hideAgain = await requestJson<{ hidden: boolean }>(`/api/matches/${matchId}/hide`, {
      method: 'POST',
      cookie: acct1.cookie,
    });
    checkEq([hideAgain.status, hideAgain.data.hidden], [200, true], 'Hide is idempotent');

    const acct1List = await requestJson<{ id: string }[]>('/api/matches?mine=1', {
      cookie: acct1.cookie,
    });
    check(!acct1List.data.some((m) => m.id === matchId), 'Hider default list excludes hidden match');

    const guest1List = await requestJson<{ id: string }[]>('/api/matches?mine=1', {
      cookie: guest1.cookie,
    });
    check(guest1List.data.some((m) => m.id === matchId), 'Other participant list still includes the match');

    const withHidden = await requestJson<{ id: string; hidden: boolean; isOwner: boolean }[]>(
      '/api/matches?mine=1&includeHidden=1',
      { cookie: acct1.cookie },
    );
    const foundHidden = withHidden.data.find((m) => m.id === matchId);
    check(Boolean(foundHidden), 'includeHidden=1 includes hidden match');
    checkEq(foundHidden?.hidden, true, 'Hidden match has hidden: true');
    checkEq(foundHidden?.isOwner, true, 'isOwner is true for host in list');

    const unhideRes = await requestJson<{ hidden: boolean }>(`/api/matches/${matchId}/unhide`, {
      method: 'POST',
      cookie: acct1.cookie,
    });
    checkEq([unhideRes.status, unhideRes.data.hidden], [200, false], 'Participant unhides match');
    const restoredList = await requestJson<{ id: string }[]>('/api/matches?mine=1', {
      cookie: acct1.cookie,
    });
    check(restoredList.data.some((m) => m.id === matchId), 'Unhide restores match in default list');

    // 3. Host deletes preparing match with WebSocket notification
    const delMatchCreate = await requestJson<{ match: { id: string } }>('/api/matches', {
      method: 'POST',
      cookie: acct1.cookie,
      body: { rulesetVersionId: house4p!.versionId },
    });
    checkEq(delMatchCreate.status, 200, 'Create match for delete test');
    const delMatchId = delMatchCreate.data.match.id;

    const delViewer = await registerEmailAccount(`delviewer_${runId}@example.com`, '删除观察者');
    const delJoin = await requestJson<{ joinRequestId: string }>(`/api/matches/${delMatchId}/join-requests`, {
      method: 'POST',
      cookie: delViewer.cookie,
      body: { requestedSeatNo: 1 },
    });
    await requestJson(`/api/matches/${delMatchId}/join-requests/${delJoin.data.joinRequestId}/approve`, {
      method: 'POST',
      cookie: acct1.cookie,
      body: { seatNo: 1 },
    });

    const delSubTicket = await requestJson<{ ticket: string }>(`/api/matches/${delMatchId}/ws-tickets`, {
      method: 'POST',
      cookie: delViewer.cookie,
      body: {},
    });
    checkEq(delSubTicket.status, 200, 'Participant mints WS ticket on deletable match');
    const delWs = new WebSocket(`${wsBaseUrl}/ws/matches/${delMatchId}?ticket=${encodeURIComponent(delSubTicket.data.ticket)}`);
    const delWsOpen = Promise.withResolvers<void>();
    const roomDeletedReceived = Promise.withResolvers<{ matchId: string }>();
    delWs.addEventListener('open', () => delWsOpen.resolve());
    delWs.addEventListener('message', (ev) => {
      try {
        const msg = JSON.parse(String(ev.data));
        if (msg.type === 'room_deleted') {
          roomDeletedReceived.resolve(msg.payload);
        }
      } catch {}
    });
    await delWsOpen.promise;

    const nonOwnerDel = await requestJson(`/api/matches/${delMatchId}`, {
      method: 'DELETE',
      cookie: delViewer.cookie,
    });
    checkEq(nonOwnerDel.status, 403, 'Non-owner participant DELETE returns 403');

    const strangerDel = await requestJson(`/api/matches/${delMatchId}`, {
      method: 'DELETE',
      cookie: strangerAcct.cookie,
    });
    check(strangerDel.status === 403 || strangerDel.status === 404, 'Stranger DELETE returns 403 or 404');

    const hostDel = await requestJson<{ deleted: boolean }>(`/api/matches/${delMatchId}`, {
      method: 'DELETE',
      cookie: acct1.cookie,
    });
    checkEq([hostDel.status, hostDel.data.deleted], [200, true], 'Host DELETE returns 200 { deleted: true }');

    const delWsPayload = await roomDeletedReceived.promise;
    checkEq(delWsPayload.matchId, delMatchId, 'Connected viewer receives room_deleted WS event with matchId');
    delWs.close();

    const postDelGet = await requestJson(`/api/matches/${delMatchId}`, { cookie: acct1.cookie });
    checkEq(postDelGet.status, 404, 'Subsequent GET on deleted match returns 404');

    const postDelList = await requestJson<{ id: string }[]>('/api/matches?mine=1&includeHidden=1', {
      cookie: acct1.cookie,
    });
    check(!postDelList.data.some((m) => m.id === delMatchId), 'Deleted match excluded from list even with includeHidden=1');

    const delEv = await pool.query<{ type: string }>(
      `SELECT type FROM app.match_events WHERE match_id = $1 AND type = 'room_deleted'`,
      [delMatchId],
    );
    checkEq(delEv.rows.length, 1, 'room_deleted event appended in match_events');

    const delAgain = await requestJson(`/api/matches/${delMatchId}`, {
      method: 'DELETE',
      cookie: acct1.cookie,
    });
    checkEq(delAgain.status, 404, 'Deleting twice returns 404 (already tombstoned)');

    const rejectedJoin = await requestJson(`/api/matches/${delMatchId}/join-requests`, {
      method: 'POST',
      cookie: delViewer.cookie,
      body: { requestedSeatNo: 2 },
    });
    checkEq(rejectedJoin.status, 404, 'Join request on deleted match is rejected with 404');

    const rejectedFinalize = await requestJson(`/api/matches/${delMatchId}/seats/finalize`, {
      method: 'POST',
      cookie: acct1.cookie,
      body: {},
    });
    checkEq(rejectedFinalize.status, 404, 'Seats finalize on deleted match is rejected with 404');

    // 4. Finalized match DELETE rejection and leave-after-finalize rejection
    const playerB = await registerEmailAccount(`playerB_${runId}@example.com`, '会员B');
    const playerC = await registerEmailAccount(`playerC_${runId}@example.com`, '会员C');
    const playerD = await registerEmailAccount(`playerD_${runId}@example.com`, '会员D');
    const finMatchId = await startReadyMatch(house4p!.versionId, [acct1, playerB, playerC, playerD]);

    const finDel = await requestJson<{ error: string }>(`/api/matches/${finMatchId}`, {
      method: 'DELETE',
      cookie: acct1.cookie,
    });
    checkEq([finDel.status, finDel.data.error], [409, 'match_not_deletable'],
      'DELETE after finalize returns 409 match_not_deletable');

    const finLeave = await requestJson<{ error: string }>(`/api/matches/${finMatchId}/leave`, {
      method: 'POST',
      cookie: playerB.cookie,
    });
    checkEq([finLeave.status, finLeave.data.error], [409, 'match_already_started'],
      'Leave after finalize returns 409 match_already_started');

    // 5. Guest leave flow in preparing match
    const leaveMatchCreate = await requestJson<{ match: { id: string } }>('/api/matches', {
      method: 'POST',
      cookie: acct1.cookie,
      body: { rulesetVersionId: house4p!.versionId },
    });
    checkEq(leaveMatchCreate.status, 200, 'Create match for leave flow');
    const leaveMatchId = leaveMatchCreate.data.match.id;

    const ownerClaimLeaveMatch = await requestJson(`/api/matches/${leaveMatchId}/seats/claim`, {
      method: 'POST',
      cookie: acct1.cookie,
      body: { seatNo: 0 },
    });
    checkEq(ownerClaimLeaveMatch.status, 200, 'Host claims seat 0 in leave match');

    const leaverUser = await registerEmailAccount(`leaver_${runId}@example.com`, '退出玩家');
    const leaverJoin = await requestJson<{ joinRequestId: string }>(`/api/matches/${leaveMatchId}/join-requests`, {
      method: 'POST',
      cookie: leaverUser.cookie,
      body: { requestedSeatNo: 1 },
    });
    checkEq(leaverJoin.status, 200, 'Guest requests seat 1');

    const approveLeaver = await requestJson(`/api/matches/${leaveMatchId}/join-requests/${leaverJoin.data.joinRequestId}/approve`, {
      method: 'POST',
      cookie: acct1.cookie,
      body: { seatNo: 1 },
    });
    checkEq(approveLeaver.status, 200, 'Host approves guest seat 1');

    const tokenForLeaver = await requestJson<{ token: string }>(`/api/matches/${leaveMatchId}/check-in-tokens`, {
      method: 'POST',
      cookie: acct1.cookie,
      body: {},
    });
    checkEq(tokenForLeaver.status, 200, 'Host issues check-in token');

    const leaverCheckIn = await requestJson(`/api/matches/${leaveMatchId}/check-ins`, {
      method: 'POST',
      cookie: leaverUser.cookie,
      body: { token: tokenForLeaver.data.token },
    });
    checkEq(leaverCheckIn.status, 200, 'Guest checks in to seat 1');

    // Host view before leave shows 2 checked in
    const beforeLeaveView = await requestJson<{ seats: { seatNo: number; status: string; principalId: string | null }[]; checkedIn: number }>(
      `/api/matches/${leaveMatchId}`,
      { cookie: acct1.cookie },
    );
    checkEq(beforeLeaveView.data.checkedIn, 2, 'Two players checked in before leave');
    checkEq(beforeLeaveView.data.seats[1].status, 'checked_in', 'Guest is checked_in at seat 1');

    // Owner calling leave -> 409 owner_must_delete
    const ownerLeaveAttempt = await requestJson<{ error: string }>(`/api/matches/${leaveMatchId}/leave`, {
      method: 'POST',
      cookie: acct1.cookie,
    });
    checkEq([ownerLeaveAttempt.status, ownerLeaveAttempt.data.error], [409, 'owner_must_delete'],
      'Owner calling leave returns 409 owner_must_delete');

    // Non-participant calling leave -> 403
    const strangerLeaveAttempt = await requestJson(`/api/matches/${leaveMatchId}/leave`, {
      method: 'POST',
      cookie: strangerAcct.cookie,
    });
    checkEq(strangerLeaveAttempt.status, 403, 'Non-participant calling leave returns 403');

    // Guest calls leave -> 200 { left: true }
    const leaveResult = await requestJson<{ left: boolean }>(`/api/matches/${leaveMatchId}/leave`, {
      method: 'POST',
      cookie: leaverUser.cookie,
    });
    checkEq([leaveResult.status, leaveResult.data.left], [200, true], 'Guest leave returns 200 { left: true }');

    // DB checks for member status, removed_at, hidden_at, invalidated check-in
    const leaverMemberDb = await pool.query<{ status: string; removed_at: Date | null; hidden_at: Date | null }>(
      `SELECT status, removed_at, hidden_at FROM app.match_members WHERE match_id = $1 AND principal_id = $2`,
      [leaveMatchId, leaverUser.principalId],
    );
    checkEq(leaverMemberDb.rows[0].status, 'left', 'Leaver status updated to left');
    check(Boolean(leaverMemberDb.rows[0].removed_at), 'Leaver removed_at is set');
    check(Boolean(leaverMemberDb.rows[0].hidden_at), 'Leaver hidden_at is set');

    const leaverCheckInDb = await pool.query<{ count: string }>(
      `SELECT count(*) FROM app.check_ins WHERE match_id = $1 AND member_id = (
         SELECT id FROM app.match_members WHERE match_id = $1 AND principal_id = $2
       ) AND invalidated_at IS NOT NULL`,
      [leaveMatchId, leaverUser.principalId],
    );
    checkEq(Number(leaverCheckInDb.rows[0].count), 1, 'Leaver check-in row was invalidated');

    // Fresh host view shows seat 1 vacant, checkedIn == 1
    const afterLeaveView = await requestJson<{ seats: { seatNo: number; status: string; principalId: string | null }[]; checkedIn: number }>(
      `/api/matches/${leaveMatchId}`,
      { cookie: acct1.cookie },
    );
    checkEq(afterLeaveView.data.checkedIn, 1, 'Only host remains checked in after guest leaves');
    checkEq(afterLeaveView.data.seats[1].status, 'empty', 'Seat 1 is empty in host view after guest leaves');
    checkEq(afterLeaveView.data.seats[1].principalId, null, 'Seat 1 principalId is null in host view');

    // Match absent from guest's list
    const leaverList = await requestJson<{ id: string }[]>('/api/matches?mine=1', {
      cookie: leaverUser.cookie,
    });
    check(!leaverList.data.some((m) => m.id === leaveMatchId), 'Match is absent from leaver match list');

    // Redeeming / using check-in by left guest fails
    const newTokenForReCheckIn = await requestJson<{ token: string }>(`/api/matches/${leaveMatchId}/check-in-tokens`, {
      method: 'POST',
      cookie: acct1.cookie,
      body: {},
    });
    const reCheckInAttempt = await requestJson(`/api/matches/${leaveMatchId}/check-ins`, {
      method: 'POST',
      cookie: leaverUser.cookie,
      body: { token: newTokenForReCheckIn.data.token },
    });
    checkEq(reCheckInAttempt.status, 403, 'Left guest cannot check in');

    // Seat claim by replacement guest succeeds
    const replacementUser = await registerEmailAccount(`replacement_${runId}@example.com`, '补位玩家');
    const replacementJoin = await requestJson<{ joinRequestId: string }>(`/api/matches/${leaveMatchId}/join-requests`, {
      method: 'POST',
      cookie: replacementUser.cookie,
      body: { requestedSeatNo: 1 },
    });
    checkEq(replacementJoin.status, 200, 'Replacement guest can request vacated seat 1');

    const approveReplacement = await requestJson(`/api/matches/${leaveMatchId}/join-requests/${replacementJoin.data.joinRequestId}/approve`, {
      method: 'POST',
      cookie: acct1.cookie,
      body: { seatNo: 1 },
    });
    checkEq(approveReplacement.status, 200, 'Host can approve replacement guest into vacated seat 1');

    const checkInReplacement = await requestJson(`/api/matches/${leaveMatchId}/check-ins`, {
      method: 'POST',
      cookie: replacementUser.cookie,
      body: { token: newTokenForReCheckIn.data.token },
    });
    checkEq(checkInReplacement.status, 200, 'Replacement guest successfully checks into vacated seat 1');

    const finalView = await requestJson<{ seats: { seatNo: number; status: string; principalId: string | null }[]; checkedIn: number }>(
      `/api/matches/${leaveMatchId}`,
      { cookie: acct1.cookie },
    );
    checkEq(finalView.data.checkedIn, 2, 'Host and replacement guest are both checked in');
    checkEq(finalView.data.seats[1].status, 'checked_in', 'Vacated seat 1 is now checked_in by replacement');
    checkEq(finalView.data.seats[1].principalId, replacementUser.principalId, 'Seat 1 belongs to replacement guest');


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
