import { createHash, createHmac, randomUUID } from 'node:crypto';
import { ENGINE_VERSION, normalizeRulesConfig } from '@riichi/engine';
import type { FastifyInstance } from 'fastify';
import {
  bindAllUnboundGuestsToMatch,
  ensureGuestSessionForPrincipal,
  requirePrincipal,
} from '../auth.js';
import { pool } from '../db.js';
import { broadcastMatchEvent } from '../ws.js';

export const MATCH_STATUS_BY_STATE: Record<string, string> = {
  preparing: 'preparing',
  active: 'in_progress',
  finished: 'finished',
  abandoned: 'abandoned',
};

export async function checkMatchAccess(
  matchId: string,
  principalId: string,
): Promise<'allowed' | 'not_found' | 'forbidden'> {
  const mRes = await pool.query<{ owner_principal_id: string }>(
    `SELECT owner_principal_id FROM app.matches WHERE id = $1`,
    [matchId],
  );
  if (mRes.rowCount === 0) {
    return 'not_found';
  }
  if (mRes.rows[0].owner_principal_id === principalId) {
    return 'allowed';
  }

  const accessRes = await pool.query(
    `SELECT 1
     FROM app.match_members mm
     WHERE mm.match_id = $1
       AND mm.principal_id = $2
       AND mm.status = 'active'
     UNION ALL
     SELECT 1
     FROM app.member_access_grants mag
     JOIN app.match_members mm ON mm.id = mag.member_id
     WHERE mm.match_id = $1
       AND mag.principal_id = $2
       AND mag.revoked_at IS NULL`,
    [matchId, principalId],
  );

  return (accessRes.rowCount ?? 0) > 0 ? 'allowed' : 'forbidden';
}

function requireAuthSecret(): string {
  const s = process.env.BETTER_AUTH_SECRET;
  if (!s) throw new Error('BETTER_AUTH_SECRET is not set');
  return s;
}

function signCheckInToken(matchId: string, nonce: string, expiresAtMs: number): string {
  const secret = requireAuthSecret();
  const payload = Buffer.from(JSON.stringify({ m: matchId, n: nonce, e: expiresAtMs })).toString('base64url');
  const sig = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function verifyCheckInTokenSignature(token: string, expectedMatchId: string): boolean {
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [payload, sig] = parts;
  const secret = requireAuthSecret();
  const expectedSig = createHmac('sha256', secret).update(payload).digest('base64url');
  if (sig !== expectedSig) return false;

  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      m?: string;
      e?: number;
    };
    if (decoded.m !== expectedMatchId) return false;
    if (typeof decoded.e !== 'number' || decoded.e <= Date.now()) return false;
    return true;
  } catch {
    return false;
  }
}

export function registerMatchesRoutes(app: FastifyInstance): void {
  // POST /api/matches { rulesetVersionId?, config?, visibility? } -> { match: { id, inviteCode, status } }
  app.post<{
    Body: {
      rulesetVersionId?: string;
      config?: Record<string, unknown>;
      visibility?: string;
    };
  }>('/api/matches', async (req, reply) => {
    const principal = await requirePrincipal(req, reply);
    if (!principal) return;

    const body = req.body ?? {};
    let rulesetVersionId: string | null = null;
    let rulesSnapshot: Record<string, unknown>;
    let rulesHash: string;
    let playerCount: 3 | 4 = 4;

    if (body.rulesetVersionId) {
      const vRes = await pool.query<{
        id: string;
        player_count: 3 | 4;
        config: Record<string, unknown>;
        config_hash: string;
      }>(
        `SELECT id, player_count, config, config_hash
         FROM app.ruleset_versions
         WHERE id = $1`,
        [body.rulesetVersionId],
      );
      const vRow = vRes.rows[0];
      if (!vRow) {
        return reply.code(404).send({ error: 'ruleset_version_not_found', message: 'Ruleset version not found' });
      }
      rulesetVersionId = vRow.id;
      playerCount = vRow.player_count;
      rulesSnapshot = vRow.config;
      rulesHash = vRow.config_hash;
    } else if (body.config && typeof body.config === 'object') {
      try {
        const norm = normalizeRulesConfig(body.config);
        playerCount = norm.playerCount;
        rulesSnapshot = body.config;
        rulesHash = createHash('sha256').update(JSON.stringify(rulesSnapshot)).digest('hex');
      } catch (err) {
        return reply.code(400).send({
          error: 'invalid_config',
          message: err instanceof Error ? err.message : 'Invalid rules config',
        });
      }
    } else {
      const defaultRes = await pool.query<{
        id: string;
        player_count: 3 | 4;
        config: Record<string, unknown>;
        config_hash: string;
      }>(
        `SELECT v.id, v.player_count, v.config, v.config_hash
         FROM app.ruleset_templates t
         JOIN app.ruleset_versions v ON v.template_id = t.id
         WHERE t.template_key = 'house_4p'
         ORDER BY v.version DESC
         LIMIT 1`,
      );
      const dRow = defaultRes.rows[0];
      if (!dRow) {
        return reply.code(500).send({ error: 'missing_seed', message: 'System default ruleset not seeded' });
      }
      rulesetVersionId = dRow.id;
      playerCount = dRow.player_count;
      rulesSnapshot = dRow.config;
      rulesHash = dRow.config_hash;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const matchRes = await client.query<{ id: string; state: string }>(
        `INSERT INTO app.matches (
           owner_principal_id,
           player_count,
           ruleset_version_id,
           rules_snapshot,
           rules_hash,
           engine_version,
           state,
           version
         )
         VALUES ($1, $2, $3, $4::jsonb, $5, $6, 'preparing', 0)
         RETURNING id, state`,
        [principal.id, playerCount, rulesetVersionId, JSON.stringify(rulesSnapshot), rulesHash, ENGINE_VERSION],
      );
      const match = matchRes.rows[0];

      const winds = playerCount === 3 ? ['E', 'S', 'W'] : ['E', 'S', 'W', 'N'];
      for (let seatNo = 0; seatNo < playerCount; seatNo++) {
        await client.query(
          `INSERT INTO app.match_seats (match_id, seat_no, player_count, initial_wind)
           VALUES ($1, $2, $3, $4)`,
          [match.id, seatNo, playerCount, winds[seatNo]],
        );
      }

      await client.query(
        `INSERT INTO app.match_members (match_id, principal_id, role, status)
         VALUES ($1, $2, 'participant', 'active')`,
        [match.id, principal.id],
      );

      const inviteCode = match.id.replace(/-/g, '').slice(0, 8).toUpperCase();
      await client.query(
        `INSERT INTO app.match_invitations (match_id, scope, generation, hmac_key_id, created_by, expires_at)
         VALUES ($1, 'join', 1, $2, $3, now() + interval '24 hours')`,
        [match.id, `invite:${inviteCode}`, principal.id],
      );

      await client.query('COMMIT');

      // Bind any anonymous guest sessions that were created prior to the first match
      await bindAllUnboundGuestsToMatch(match.id);

      return {
        match: {
          id: match.id,
          inviteCode,
          status: MATCH_STATUS_BY_STATE[match.state] ?? match.state,
        },
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  });

  // GET /api/matches?mine=1 -> [{ id, status, playerCount, createdAt }]
  app.get<{ Querystring: { mine?: string } }>('/api/matches', async (req, reply) => {
    const principal = await requirePrincipal(req, reply);
    if (!principal) return;

    const res = await pool.query<{
      id: string;
      state: string;
      player_count: number;
      created_at: Date;
    }>(
      `SELECT DISTINCT m.id, m.state, m.player_count, m.created_at
       FROM app.matches m
       LEFT JOIN app.match_members mm ON mm.match_id = m.id AND mm.status = 'active'
       LEFT JOIN app.member_access_grants mag ON mag.member_id = mm.id AND mag.revoked_at IS NULL
       WHERE m.owner_principal_id = $1
          OR mm.principal_id = $1
          OR mag.principal_id = $1
       ORDER BY m.created_at DESC`,
      [principal.id],
    );

    return res.rows.map((row) => ({
      id: row.id,
      status: MATCH_STATUS_BY_STATE[row.state] ?? row.state,
      playerCount: row.player_count,
      createdAt: row.created_at.toISOString(),
    }));
  });

  // GET /api/matches/:id -> { match, seats:[{seatNo, principalId, displayName, points, status}], currentHand, scoreboard:[{seatNo, points}], checkedIn: number }
  app.get<{ Params: { id: string } }>('/api/matches/:id', async (req, reply) => {
    const principal = await requirePrincipal(req, reply);
    if (!principal) return;

    const matchId = req.params.id;
    const access = await checkMatchAccess(matchId, principal.id);
    if (access === 'not_found') {
      return reply.code(404).send({ error: 'match_not_found', message: 'Match not found' });
    }
    if (access === 'forbidden') {
      return reply.code(403).send({ error: 'forbidden', message: 'Access denied' });
    }

    const mRes = await pool.query<{
      id: string;
      owner_principal_id: string;
      player_count: number;
      ruleset_version_id: string | null;
      rules_snapshot: Record<string, unknown>;
      rules_hash: string;
      engine_version: string;
      state: string;
      version: string;
      current_hand_id: string | null;
      created_at: Date;
      started_at: Date | null;
      ended_at: Date | null;
    }>(`SELECT * FROM app.matches WHERE id = $1`, [matchId]);
    const m = mRes.rows[0];

    const norm = normalizeRulesConfig(m.rules_snapshot, m.player_count);

    const seatsRes = await pool.query<{
      seat_no: number;
      principal_id: string | null;
      display_name: string | null;
      has_check_in: boolean;
      balance: number | null;
    }>(
      `SELECT
         ms.seat_no,
         mm.principal_id,
         p.display_name,
         EXISTS (
           SELECT 1 FROM app.check_ins ci
           WHERE ci.seat_assignment_id = sa.id AND ci.invalidated_at IS NULL
         ) AS has_check_in,
         (
           SELECT (a.opening_balance + COALESCE(SUM(e.amount), 0))::int
           FROM app.score_accounts a
           LEFT JOIN app.score_entries e ON e.account_id = a.id
           WHERE a.match_id = ms.match_id AND a.kind = 'seat' AND a.seat_no = ms.seat_no
           GROUP BY a.id, a.opening_balance
         ) AS balance
       FROM app.match_seats ms
       LEFT JOIN app.seat_assignments sa
         ON sa.match_id = ms.match_id AND sa.seat_no = ms.seat_no AND sa.end_hand_no IS NULL
       LEFT JOIN app.match_members mm
         ON mm.match_id = sa.match_id AND mm.id = sa.member_id
       LEFT JOIN app.principals p
         ON p.id = mm.principal_id
       WHERE ms.match_id = $1
       ORDER BY ms.seat_no ASC`,
      [matchId],
    );

    const seats = seatsRes.rows.map((r) => ({
      seatNo: r.seat_no,
      principalId: r.principal_id,
      displayName: r.display_name,
      points: r.balance ?? norm.startingPoints,
      status: r.has_check_in ? 'checked_in' : r.principal_id ? 'assigned' : 'empty',
    }));

    const scoreboard = seats.map((s) => ({
      seatNo: s.seatNo,
      points: s.points,
    }));

    const checkInCountRes = await pool.query<{ cnt: number }>(
      `SELECT COUNT(*)::int AS cnt
       FROM app.check_ins
       WHERE match_id = $1 AND invalidated_at IS NULL`,
      [matchId],
    );
    const checkedIn = checkInCountRes.rows[0]?.cnt ?? 0;

    let currentHand: Record<string, unknown> | null = null;
    if (m.current_hand_id) {
      const hRes = await pool.query<{
        id: string;
        hand_no: number;
        round_wind: string;
        round_number: number;
        dealer_seat_no: number;
        honba: number;
        riichi_pool_before: number;
        mark_revision: string;
        result_revision: string;
        state: string;
      }>(`SELECT * FROM app.hands WHERE id = $1 AND match_id = $2`, [m.current_hand_id, matchId]);
      const h = hRes.rows[0];
      if (h) {
        const marksRes = await pool.query<{ seat_no: number }>(
          `SELECT seat_no FROM app.hand_riichi_marks WHERE hand_id = $1 AND marked = true`,
          [h.id],
        );
        const markedSeats: Record<number, true> = {};
        for (const mr of marksRes.rows) {
          markedSeats[mr.seat_no] = true;
        }
        currentHand = {
          id: h.id,
          handId: h.id,
          handNo: h.hand_no,
          roundWind: h.round_wind,
          roundNumber: h.round_number,
          dealerSeatNo: h.dealer_seat_no,
          honba: h.honba,
          riichiPool: h.riichi_pool_before,
          markRevision: Number(h.mark_revision),
          resultRevision: Number(h.result_revision),
          state: h.state,
          status: h.state,
          seats: seats.map((s) => ({
            seatNo: s.seatNo,
            points: s.points,
            isRiichi: Boolean(markedSeats[s.seatNo]),
          })),
        };
      }
    }

    const settleRes = await pool.query(
      `SELECT 1 FROM app.settlements WHERE match_id = $1 AND superseded_at IS NULL LIMIT 1`,
      [matchId],
    );
    const settlementConfirmed = (settleRes.rowCount ?? 0) > 0;
    return {
      match: {
        id: m.id,
        ownerPrincipalId: m.owner_principal_id,
        playerCount: m.player_count,
        rulesetVersionId: m.ruleset_version_id,
        rulesSnapshot: m.rules_snapshot,
        rulesHash: m.rules_hash,
        engineVersion: m.engine_version,
        status: MATCH_STATUS_BY_STATE[m.state] ?? m.state,
        state: m.state,
        version: Number(m.version),
        currentHandId: m.current_hand_id,
        settlementConfirmed,
        createdAt: m.created_at.toISOString(),
        startedAt: m.started_at?.toISOString() ?? null,
        endedAt: m.ended_at?.toISOString() ?? null,
      },
      seats,
      currentHand,
      scoreboard,
      checkedIn,
    };
  });

  // POST /api/matches/:id/join-requests {} -> { joinRequestId, status:'pending' }
  app.post<{ Params: { id: string }; Body: { requestedSeatNo?: number } }>(
    '/api/matches/:id/join-requests',
    async (req, reply) => {
      const principal = await requirePrincipal(req, reply);
      if (!principal) return;

      const matchId = req.params.id;
      if (principal.type === 'guest') {
        await ensureGuestSessionForPrincipal(principal.id, principal.authUserId, matchId);
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        const mRes = await client.query<{ id: string; owner_principal_id: string; player_count: number; state: string }>(
          `SELECT id, owner_principal_id, player_count, state FROM app.matches WHERE id = $1 FOR UPDATE`,
          [matchId],
        );
        const match = mRes.rows[0];
        if (!match) {
          await client.query('ROLLBACK');
          return reply.code(404).send({ error: 'match_not_found', message: 'Match not found' });
        }

        const existingJr = await client.query<{ id: string; status: string }>(
          `SELECT id, status FROM app.join_requests
           WHERE match_id = $1 AND principal_id = $2 AND status = 'pending'`,
          [matchId, principal.id],
        );
        if (existingJr.rows[0]) {
          await client.query('COMMIT');
          return {
            joinRequestId: existingJr.rows[0].id,
            status: 'pending' as const,
          };
        }

        let invRes = await client.query<{ id: string }>(
          `SELECT id FROM app.match_invitations WHERE match_id = $1 AND scope = 'join' ORDER BY created_at ASC LIMIT 1`,
          [matchId],
        );
        if (!invRes.rows[0]) {
          invRes = await client.query<{ id: string }>(
            `INSERT INTO app.match_invitations (match_id, scope, generation, hmac_key_id, created_by, expires_at)
             VALUES ($1, 'join', 1, 'default', $2, now() + interval '24 hours')
             RETURNING id`,
            [matchId, match.owner_principal_id],
          );
        }

        const requestedSeatNo =
          typeof req.body?.requestedSeatNo === 'number' ? req.body.requestedSeatNo : null;
        if (
          requestedSeatNo !== null &&
          (!Number.isInteger(requestedSeatNo) || requestedSeatNo < 0 || requestedSeatNo >= match.player_count)
        ) {
          await client.query('ROLLBACK');
          return reply.code(400).send({ error: 'invalid_seat', message: 'Invalid requestedSeatNo' });
        }

        const jrRes = await client.query<{ id: string; status: string }>(
          `INSERT INTO app.join_requests (match_id, invitation_id, principal_id, requested_seat_no, status)
           VALUES ($1, $2, $3, $4, 'pending')
           RETURNING id, status`,
          [matchId, invRes.rows[0].id, principal.id, requestedSeatNo],
        );

        await client.query('COMMIT');
        return {
          joinRequestId: jrRes.rows[0].id,
          status: 'pending' as const,
        };
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },
  );

  // POST /api/matches/:id/join-requests/:jrId/approve { seatNo } -> 200 (owner only; 409 on seat taken)
  app.post<{
    Params: { id: string; jrId: string };
    Body: { seatNo: number };
  }>('/api/matches/:id/join-requests/:jrId/approve', async (req, reply) => {
    const principal = await requirePrincipal(req, reply);
    if (!principal) return;

    const { id: matchId, jrId } = req.params;
    const seatNo = req.body?.seatNo;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const mRes = await client.query<{
        id: string;
        owner_principal_id: string;
        player_count: number;
        state: string;
      }>(`SELECT id, owner_principal_id, player_count, state FROM app.matches WHERE id = $1 FOR UPDATE`, [matchId]);
      const match = mRes.rows[0];
      if (!match) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: 'match_not_found', message: 'Match not found' });
      }
      if (match.owner_principal_id !== principal.id) {
        await client.query('ROLLBACK');
        return reply.code(403).send({ error: 'forbidden', message: 'Only the match owner can approve join requests' });
      }
      if (match.state !== 'preparing') {
        await client.query('ROLLBACK');
        return reply.code(409).send({ error: 'match_already_started', message: 'Match is not in preparing state' });
      }

      if (typeof seatNo !== 'number' || !Number.isInteger(seatNo) || seatNo < 0 || seatNo >= match.player_count) {
        await client.query('ROLLBACK');
        return reply.code(400).send({ error: 'invalid_seat', message: 'Invalid seatNo' });
      }

      const jrRes = await client.query<{
        id: string;
        principal_id: string;
        status: string;
      }>(
        `SELECT id, principal_id, status
         FROM app.join_requests
         WHERE id = $1 AND match_id = $2
         FOR UPDATE`,
        [jrId, matchId],
      );
      const jr = jrRes.rows[0];
      if (!jr) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: 'join_request_not_found', message: 'Join request not found' });
      }
      if (jr.status !== 'pending') {
        await client.query('ROLLBACK');
        return reply.code(409).send({ error: 'join_request_already_decided', message: 'Join request already decided' });
      }

      // Check if seat is already taken in seat_assignments
      const takenRes = await client.query<{ id: string }>(
        `SELECT id FROM app.seat_assignments
         WHERE match_id = $1 AND seat_no = $2 AND end_hand_no IS NULL`,
        [matchId, seatNo],
      );
      if ((takenRes.rowCount ?? 0) > 0) {
        await client.query('ROLLBACK');
        return reply.code(409).send({ error: 'seat_taken', message: `Seat ${seatNo} is already taken` });
      }

      // Ensure member row exists for requester
      const memRes = await client.query<{ id: string }>(
        `INSERT INTO app.match_members (match_id, principal_id, role, status)
         VALUES ($1, $2, 'participant', 'active')
         ON CONFLICT (match_id, principal_id)
         DO UPDATE SET status = 'active', removed_at = NULL
         RETURNING id`,
        [matchId, jr.principal_id],
      );
      const memberId = memRes.rows[0].id;

      // Ensure requester doesn't already occupy another seat
      const existingMemberSeat = await client.query<{ id: string; seat_no: number }>(
        `SELECT id, seat_no FROM app.seat_assignments
         WHERE match_id = $1 AND member_id = $2 AND end_hand_no IS NULL`,
        [matchId, memberId],
      );
      if (existingMemberSeat.rows[0] && existingMemberSeat.rows[0].seat_no !== seatNo) {
        await client.query('ROLLBACK');
        return reply.code(409).send({ error: 'member_already_seated', message: 'Member already occupies another seat' });
      }

      let seatAssignmentId = existingMemberSeat.rows[0]?.id;
      if (!seatAssignmentId) {
        const saRes = await client.query<{ id: string }>(
          `INSERT INTO app.seat_assignments (match_id, seat_no, member_id, start_hand_no, confirmed_by)
           VALUES ($1, $2, $3, 0, $4)
           RETURNING id`,
          [matchId, seatNo, memberId, principal.id],
        );
        seatAssignmentId = saRes.rows[0].id;
      }

      await client.query(
        `UPDATE app.join_requests
         SET status = 'approved',
             requested_seat_no = $1,
             approved_by = $2,
             decided_at = now()
         WHERE id = $3 AND match_id = $4`,
        [seatNo, principal.id, jrId, matchId],
      );

      await client.query('COMMIT');

      broadcastMatchEvent(matchId, 'join_approved', {
        matchId,
        joinRequestId: jrId,
        principalId: jr.principal_id,
        seatNo,
        seatAssignmentId,
      });

      return reply.code(200).send({
        ok: true,
        joinRequestId: jrId,
        seatNo,
        seatAssignmentId,
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  });

  // POST /api/matches/:id/check-in-tokens {} -> { token, expiresAt }
  app.post<{ Params: { id: string } }>('/api/matches/:id/check-in-tokens', async (req, reply) => {
    const principal = await requirePrincipal(req, reply);
    if (!principal) return;

    const matchId = req.params.id;
    const mRes = await pool.query<{ owner_principal_id: string; state: string }>(
      `SELECT owner_principal_id, state FROM app.matches WHERE id = $1`,
      [matchId],
    );
    const match = mRes.rows[0];
    if (!match) {
      return reply.code(404).send({ error: 'match_not_found', message: 'Match not found' });
    }
    if (match.owner_principal_id !== principal.id) {
      return reply.code(403).send({ error: 'forbidden', message: 'Only the match owner can issue check-in tokens' });
    }
    if (match.state !== 'preparing') {
      return reply.code(409).send({ error: 'match_already_started', message: 'Match has already started' });
    }

    const expiresAtMs = Date.now() + 10 * 60 * 1000;
    const expiresAt = new Date(expiresAtMs);
    const nonce = randomUUID();
    const token = signCheckInToken(matchId, nonce, expiresAtMs);
    const tokenHash = createHash('sha256').update(token).digest('hex');

    await pool.query(
      `INSERT INTO app.match_invitations (match_id, scope, generation, hmac_key_id, created_by, expires_at)
       VALUES ($1, 'join', 1, $2, $3, $4)`,
      [matchId, tokenHash, principal.id, expiresAt],
    );

    return {
      token,
      expiresAt: expiresAt.toISOString(),
    };
  });

  // POST /api/matches/:id/check-ins { token, alias? } -> { seat: { seatNo }, grantId }
  app.post<{
    Params: { id: string };
    Body: { token?: string; alias?: string };
  }>('/api/matches/:id/check-ins', async (req, reply) => {
    const principal = await requirePrincipal(req, reply);
    if (!principal) return;

    const matchId = req.params.id;
    const { token, alias } = req.body ?? {};
    if (!token || typeof token !== 'string') {
      return reply.code(400).send({ error: 'missing_token', message: 'Check-in token is required' });
    }

    if (!verifyCheckInTokenSignature(token, matchId)) {
      return reply.code(400).send({ error: 'invalid_token', message: 'Invalid or expired check-in token' });
    }

    if (principal.type === 'guest') {
      await ensureGuestSessionForPrincipal(principal.id, principal.authUserId, matchId);
    }

    const tokenHash = createHash('sha256').update(token).digest('hex');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const mRes = await client.query<{
        id: string;
        owner_principal_id: string;
        player_count: number;
        rules_hash: string;
        state: string;
      }>(
        `SELECT id, owner_principal_id, player_count, rules_hash, state
         FROM app.matches
         WHERE id = $1
         FOR UPDATE`,
        [matchId],
      );
      const match = mRes.rows[0];
      if (!match) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: 'match_not_found', message: 'Match not found' });
      }
      if (match.state !== 'preparing') {
        await client.query('ROLLBACK');
        return reply.code(409).send({ error: 'match_already_started', message: 'Match is not in preparing state' });
      }

      // Atomically consume the hashed single-use check-in token
      const consumeRes = await client.query<{ id: string }>(
        `UPDATE app.match_invitations
         SET revoked_at = now()
         WHERE match_id = $1
           AND hmac_key_id = $2
           AND revoked_at IS NULL
           AND expires_at > now()
         RETURNING id`,
        [matchId, tokenHash],
      );
      if (consumeRes.rowCount === 0) {
        await client.query('ROLLBACK');
        return reply.code(400).send({ error: 'token_consumed_or_expired', message: 'Check-in token already used or expired' });
      }

      if (typeof alias === 'string' && alias.trim().length > 0) {
        await client.query(
          `UPDATE app.principals SET display_name = $1 WHERE id = $2`,
          [alias.trim().slice(0, 64), principal.id],
        );
      }

      // Ensure match_members row
      const memRes = await client.query<{ id: string }>(
        `INSERT INTO app.match_members (match_id, principal_id, role, status)
         VALUES ($1, $2, 'participant', 'active')
         ON CONFLICT (match_id, principal_id)
         DO UPDATE SET status = 'active', removed_at = NULL
         RETURNING id`,
        [matchId, principal.id],
      );
      const memberId = memRes.rows[0].id;

      // Find or create seat_assignments row for this member
      const existingSa = await client.query<{ id: string; seat_no: number }>(
        `SELECT id, seat_no
         FROM app.seat_assignments
         WHERE match_id = $1 AND member_id = $2 AND end_hand_no IS NULL`,
        [matchId, memberId],
      );

      let seatAssignmentId: string;
      let seatNo: number;

      if (existingSa.rows[0]) {
        seatAssignmentId = existingSa.rows[0].id;
        seatNo = existingSa.rows[0].seat_no;
      } else {
        const occupiedRes = await client.query<{ seat_no: number }>(
          `SELECT seat_no
           FROM app.seat_assignments
           WHERE match_id = $1 AND end_hand_no IS NULL`,
          [matchId],
        );
        const occupied: Record<number, true> = {};
        for (const r of occupiedRes.rows) {
          occupied[r.seat_no] = true;
        }
        let chosenSeat: number | null = null;
        for (let s = 0; s < match.player_count; s++) {
          if (!occupied[s]) {
            chosenSeat = s;
            break;
          }
        }
        if (chosenSeat === null) {
          await client.query('ROLLBACK');
          return reply.code(409).send({ error: 'table_full', message: 'All seats are already occupied' });
        }
        seatNo = chosenSeat;
        const saInsert = await client.query<{ id: string }>(
          `INSERT INTO app.seat_assignments (match_id, seat_no, member_id, start_hand_no, confirmed_by)
           VALUES ($1, $2, $3, 0, $4)
           RETURNING id`,
          [matchId, seatNo, memberId, match.owner_principal_id],
        );
        seatAssignmentId = saInsert.rows[0].id;
      }

      // Invalidate any prior active check-in on this seat assignment, then insert new check_ins row
      await client.query(
        `UPDATE app.check_ins
         SET invalidated_at = now()
         WHERE seat_assignment_id = $1 AND invalidated_at IS NULL`,
        [seatAssignmentId],
      );
      await client.query(
        `INSERT INTO app.check_ins (
           match_id,
           member_id,
           seat_assignment_id,
           rules_hash,
           method,
           confirmed_at,
           host_confirmed_at,
           host_confirmed_by
         )
         VALUES ($1, $2, $3, $4, 'qr_scan', now(), now(), $5)`,
        [matchId, memberId, seatAssignmentId, match.rules_hash, match.owner_principal_id],
      );

      // Ensure member_access_grants row
      const existingGrant = await client.query<{ id: string }>(
        `SELECT id FROM app.member_access_grants
         WHERE member_id = $1 AND principal_id = $2 AND revoked_at IS NULL`,
        [memberId, principal.id],
      );
      let grantId: string;
      if (existingGrant.rows[0]) {
        grantId = existingGrant.rows[0].id;
      } else {
        const grantInsert = await client.query<{ id: string }>(
          `INSERT INTO app.member_access_grants (member_id, principal_id)
           VALUES ($1, $2)
           RETURNING id`,
          [memberId, principal.id],
        );
        grantId = grantInsert.rows[0].id;
      }

      await client.query('COMMIT');

      broadcastMatchEvent(matchId, 'check_in', {
        matchId,
        seatNo,
        principalId: principal.id,
        grantId,
      });

      return {
        seat: { seatNo },
        grantId,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  });

  // POST /api/matches/:id/seats/finalize {} -> { seats } (owner; status -> in_progress; creates score_accounts at start points)
  app.post<{ Params: { id: string } }>('/api/matches/:id/seats/finalize', async (req, reply) => {
    const principal = await requirePrincipal(req, reply);
    if (!principal) return;

    const matchId = req.params.id;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const mRes = await client.query<{
        id: string;
        owner_principal_id: string;
        player_count: number;
        rules_snapshot: Record<string, unknown>;
        rules_hash: string;
        state: string;
        version: string;
      }>(`SELECT * FROM app.matches WHERE id = $1 FOR UPDATE`, [matchId]);
      const match = mRes.rows[0];
      if (!match) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: 'match_not_found', message: 'Match not found' });
      }
      if (match.owner_principal_id !== principal.id) {
        await client.query('ROLLBACK');
        return reply.code(403).send({ error: 'forbidden', message: 'Only the match owner can finalize seats' });
      }
      if (match.state !== 'preparing') {
        await client.query('ROLLBACK');
        return reply.code(409).send({ error: 'match_already_started', message: 'Seats are already finalized' });
      }

      const seatsRes = await client.query<{
        seat_no: number;
        seat_assignment_id: string;
        member_id: string;
        principal_id: string;
        display_name: string;
        check_in_id: string | null;
      }>(
        `SELECT
           ms.seat_no,
           sa.id AS seat_assignment_id,
           mm.id AS member_id,
           mm.principal_id,
           p.display_name,
           ci.id AS check_in_id
         FROM app.match_seats ms
         LEFT JOIN app.seat_assignments sa
           ON sa.match_id = ms.match_id AND sa.seat_no = ms.seat_no AND sa.end_hand_no IS NULL
         LEFT JOIN app.match_members mm
           ON mm.match_id = sa.match_id AND mm.id = sa.member_id AND mm.status = 'active'
         LEFT JOIN app.principals p
           ON p.id = mm.principal_id
         LEFT JOIN app.check_ins ci
           ON ci.seat_assignment_id = sa.id AND ci.invalidated_at IS NULL AND ci.rules_hash = $2
         WHERE ms.match_id = $1
         ORDER BY ms.seat_no ASC`,
        [matchId, match.rules_hash],
      );

      if (
        seatsRes.rows.length !== match.player_count ||
        seatsRes.rows.some((r) => !r.seat_assignment_id || !r.check_in_id)
      ) {
        await client.query('ROLLBACK');
        return reply.code(400).send({
          error: 'incomplete_check_ins',
          message: `All ${match.player_count} seats must be assigned and checked in before finalizing`,
        });
      }

      const norm = normalizeRulesConfig(match.rules_snapshot, match.player_count);
      const startingPoints = norm.startingPoints;

      // Create score_accounts for each seat and the riichi_pool account
      for (let seatNo = 0; seatNo < match.player_count; seatNo++) {
        await client.query(
          `INSERT INTO app.score_accounts (match_id, kind, seat_no, opening_balance)
           VALUES ($1, 'seat', $2, $3)
           ON CONFLICT (match_id, seat_no) DO NOTHING`,
          [matchId, seatNo, startingPoints],
        );
      }
      await client.query(
        `INSERT INTO app.score_accounts (match_id, kind, seat_no, opening_balance)
         VALUES ($1, 'riichi_pool', NULL, 0)
         ON CONFLICT (match_id, kind) WHERE kind <> 'seat' DO NOTHING`,
        [matchId],
      );

      const seats = seatsRes.rows.map((r) => ({
        seatNo: r.seat_no,
        principalId: r.principal_id,
        displayName: r.display_name,
        points: startingPoints,
        status: 'checked_in',
      }));

      const newSeq = Number(match.version) + 1;
      const reqHash = createHash('sha256').update(`seats_finalized:${matchId}`).digest('hex');
      const evRes = await client.query<{ id: string }>(
        `INSERT INTO app.match_events (
           match_id, seq, hand_id, actor_principal_id, client_event_id, request_hash, type, payload
         )
         VALUES ($1, $2, NULL, $3, $4, $5, 'seats_finalized', $6::jsonb)
         RETURNING id`,
        [matchId, newSeq, principal.id, randomUUID(), reqHash, JSON.stringify({ seats })],
      );

      await client.query(
        `INSERT INTO app.outbox_messages (event_id, topic, payload, published_at)
         VALUES ($1, 'match_events', $2::jsonb, now())`,
        [evRes.rows[0].id, JSON.stringify({ type: 'seats_finalized', matchId, seats })],
      );

      await client.query(
        `UPDATE app.matches
         SET state = 'active',
             started_at = now(),
             version = $1
         WHERE id = $2`,
        [newSeq, matchId],
      );

      await client.query('COMMIT');

      broadcastMatchEvent(matchId, 'seats_finalized', { matchId, seats });

      return { seats };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  });
}
