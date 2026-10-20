import { createHash, randomUUID } from 'node:crypto';
import {
  calculateSettlement,
  calculateTerminalSettlement,
  normalizeRulesConfig,
  type HandState,
  type ResultInput,
  type SettlementOutput,
  type WinnerInput,
} from '@riichi/engine';
import type { FastifyInstance } from 'fastify';
import { requirePrincipal } from '../auth.js';
import { pool } from '../db.js';
import { broadcastMatchEvent } from '../ws.js';
import { checkMatchAccess } from './matches.js';

function normalizeIncomingResultInput(raw: Record<string, unknown>): ResultInput {
  const kind = raw.kind as ResultInput['kind'];
  const topDealIn =
    typeof raw.dealInSeatNo === 'number' ? raw.dealInSeatNo : null;
  const topRiichiDealIn =
    typeof raw.isRiichiDeclarationDealIn === 'boolean'
      ? raw.isRiichiDeclarationDealIn
      : undefined;

  let winners: WinnerInput[] = [];
  if (Array.isArray(raw.winners)) {
    winners = (raw.winners as Record<string, unknown>[]).map((w) => ({
      seatNo: Number(w.seatNo),
      han: Number(w.han ?? 0),
      fu: Number(w.fu ?? 30),
      ...(typeof w.yakumanCount === 'number' ? { yakumanCount: w.yakumanCount } : {}),
      ...(w.dealInSeatNo !== undefined
        ? { dealInSeatNo: w.dealInSeatNo as number | null }
        : topDealIn !== null && kind === 'ron'
          ? { dealInSeatNo: topDealIn }
          : {}),
      ...(typeof w.isRiichiDeclarationDealIn === 'boolean'
        ? { isRiichiDeclarationDealIn: w.isRiichiDeclarationDealIn }
        : topRiichiDealIn !== undefined
          ? { isRiichiDeclarationDealIn: topRiichiDealIn }
          : {}),
    }));
  } else if (typeof raw.winnerSeatNo === 'number' || typeof raw.seatNo === 'number') {
    const wSeat = typeof raw.winnerSeatNo === 'number' ? raw.winnerSeatNo : (raw.seatNo as number);
    winners = [
      {
        seatNo: wSeat,
        han: Number(raw.han ?? 0),
        fu: Number(raw.fu ?? 30),
        ...(typeof raw.yakumanCount === 'number' ? { yakumanCount: raw.yakumanCount } : {}),
        ...(topDealIn !== null && kind === 'ron' ? { dealInSeatNo: topDealIn } : {}),
        ...(topRiichiDealIn !== undefined ? { isRiichiDeclarationDealIn: topRiichiDealIn } : {}),
      },
    ];
  }

  return {
    kind,
    winners,
    tenpai: Array.isArray(raw.tenpai) ? (raw.tenpai as boolean[]) : null,
    chomboRole: (raw.chomboRole as Record<number, 'offender' | 'victim'> | null | undefined) ?? null,
    riichiDeclarationDealInSeatNo:
      typeof raw.riichiDeclarationDealInSeatNo === 'number'
        ? raw.riichiDeclarationDealInSeatNo
        : null,
    manualPayments: (raw.manualPayments as Record<number, number> | null | undefined) ?? null,
  };
}

export function registerHandsRoutes(app: FastifyInstance): void {
  // POST /api/matches/:id/hands {} -> { hand: { id, roundWind, roundNumber, dealerSeatNo, honba, riichiPool, markRevision, resultRevision } }
  app.post<{ Params: { id: string } }>('/api/matches/:id/hands', async (req, reply) => {
    const principal = await requirePrincipal(req, reply);
    if (!principal) return;

    const matchId = req.params.id;
    const access = await checkMatchAccess(matchId, principal.id);
    if (access === 'not_found') {
      return reply.code(404).send({ error: 'match_not_found', message: 'Match not found' });
    }
    if (access === 'forbidden') {
      return reply.code(403).send({ error: 'forbidden', message: 'Not a confirmed device/member of this match' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const mRes = await client.query<{
        id: string;
        state: string;
        version: string;
        current_hand_id: string | null;
      }>(`SELECT id, state, version, current_hand_id FROM app.matches WHERE id = $1 FOR UPDATE`, [matchId]);
      const match = mRes.rows[0];
      if (!match) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: 'match_not_found', message: 'Match not found' });
      }
      if (match.state !== 'active') {
        await client.query('ROLLBACK');
        return reply.code(409).send({ error: 'match_not_active', message: 'Match must be in progress to open a hand' });
      }

      // Check if an open hand already exists
      const openHandRes = await client.query<{
        id: string;
        hand_no: number;
        round_wind: string;
        round_number: number;
        dealer_seat_no: number;
        honba: number;
        riichi_pool_before: number;
        mark_revision: string;
        result_revision: string;
      }>(
        `SELECT * FROM app.hands
         WHERE match_id = $1 AND state = 'open'
         ORDER BY hand_no DESC LIMIT 1`,
        [matchId],
      );
      if (openHandRes.rows[0]) {
        const h = openHandRes.rows[0];
        await client.query('COMMIT');
        return {
          hand: {
            id: h.id,
            roundWind: h.round_wind,
            roundNumber: h.round_number,
            dealerSeatNo: h.dealer_seat_no,
            honba: h.honba,
            riichiPool: h.riichi_pool_before,
            markRevision: Number(h.mark_revision),
            resultRevision: Number(h.result_revision),
          },
        };
      }

      // Determine next hand parameters from previous settled hand (if any)
      const prevHandRes = await client.query<{
        hand_no: number;
        calculation: {
          nextHand?: {
            roundWind: string;
            roundNumber: number;
            dealerSeatNo: number;
            honba: number;
            riichiPool: number;
          };
        } | null;
      }>(
        `SELECT h.hand_no, hr.calculation
         FROM app.hands h
         LEFT JOIN app.hand_results hr ON hr.hand_id = h.id AND hr.superseded_at IS NULL
         WHERE h.match_id = $1
         ORDER BY h.hand_no DESC
         LIMIT 1`,
        [matchId],
      );

      let handNo = 1;
      let roundWind = 'E';
      let roundNumber = 1;
      let dealerSeatNo = 0;
      let honba = 0;
      let riichiPool = 0;

      const prev = prevHandRes.rows[0];
      if (prev) {
        handNo = prev.hand_no + 1;
        const nh = prev.calculation?.nextHand;
        if (nh) {
          roundWind = nh.roundWind;
          roundNumber = nh.roundNumber;
          dealerSeatNo = nh.dealerSeatNo;
          honba = nh.honba;
          riichiPool = nh.riichiPool;
        }
      }

      // Also check actual riichi_pool account balance in score_accounts
      const poolRes = await client.query<{ balance: number }>(
        `SELECT (a.opening_balance + COALESCE(SUM(e.amount), 0))::int AS balance
         FROM app.score_accounts a
         LEFT JOIN app.score_entries e ON e.account_id = a.id
         WHERE a.match_id = $1 AND a.kind = 'riichi_pool'
         GROUP BY a.id, a.opening_balance`,
        [matchId],
      );
      if (poolRes.rows[0]) {
        riichiPool = poolRes.rows[0].balance;
      }

      const hInsert = await client.query<{
        id: string;
        round_wind: string;
        round_number: number;
        dealer_seat_no: number;
        honba: number;
        riichi_pool_before: number;
        mark_revision: string;
        result_revision: string;
      }>(
        `INSERT INTO app.hands (
           match_id, hand_no, round_wind, round_number, dealer_seat_no, honba, riichi_pool_before, mark_revision, result_revision, state
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, 0, 0, 'open')
         RETURNING id, round_wind, round_number, dealer_seat_no, honba, riichi_pool_before, mark_revision, result_revision`,
        [matchId, handNo, roundWind, roundNumber, dealerSeatNo, honba, riichiPool],
      );
      const h = hInsert.rows[0];

      const newSeq = Number(match.version) + 1;
      const handPayload = {
        id: h.id,
        roundWind: h.round_wind,
        roundNumber: h.round_number,
        dealerSeatNo: h.dealer_seat_no,
        honba: h.honba,
        riichiPool: h.riichi_pool_before,
        markRevision: Number(h.mark_revision),
        resultRevision: Number(h.result_revision),
      };

      const reqHash = createHash('sha256').update(`hand_started:${matchId}:${handNo}`).digest('hex');
      const evRes = await client.query<{ id: string }>(
        `INSERT INTO app.match_events (
           match_id, seq, hand_id, actor_principal_id, client_event_id, request_hash, type, payload
         )
         VALUES ($1, $2, $3, $4, $5, $6, 'hand_started', $7::jsonb)
         RETURNING id`,
        [matchId, newSeq, h.id, principal.id, randomUUID(), reqHash, JSON.stringify({ hand: handPayload })],
      );

      await client.query(
        `INSERT INTO app.outbox_messages (event_id, topic, payload, published_at)
         VALUES ($1, 'match_events', $2::jsonb, now())`,
        [evRes.rows[0].id, JSON.stringify({ type: 'hand_started', matchId, hand: handPayload })],
      );

      await client.query(
        `UPDATE app.matches SET current_hand_id = $1, version = $2 WHERE id = $3`,
        [h.id, newSeq, matchId],
      );

      await client.query('COMMIT');

      broadcastMatchEvent(matchId, 'hand_started', { matchId, hand: handPayload });

      return { hand: handPayload };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  });

  // POST /api/matches/:id/hands/:handId/marks { seatNo, riichi } -> { markRevision }
  app.post<{
    Params: { id: string; handId: string };
    Body: { seatNo: number; riichi: boolean };
  }>('/api/matches/:id/hands/:handId/marks', async (req, reply) => {
    const principal = await requirePrincipal(req, reply);
    if (!principal) return;

    const { id: matchId, handId } = req.params;
    const { seatNo, riichi } = req.body ?? {};

    const access = await checkMatchAccess(matchId, principal.id);
    if (access === 'not_found') {
      return reply.code(404).send({ error: 'match_not_found', message: 'Match not found' });
    }
    if (access === 'forbidden') {
      return reply.code(403).send({ error: 'forbidden', message: 'Not a member of this match' });
    }

    if (typeof seatNo !== 'number' || !Number.isInteger(seatNo) || typeof riichi !== 'boolean') {
      return reply.code(400).send({ error: 'invalid_input', message: 'seatNo (int) and riichi (boolean) are required' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      await client.query(`SELECT id FROM app.principals WHERE id = $1 FOR SHARE`, [principal.id]);

      const mRes = await client.query<{
        id: string;
        player_count: number;
        rules_snapshot: Record<string, unknown>;
        state: string;
        version: string;
      }>(`SELECT id, player_count, rules_snapshot, state, version FROM app.matches WHERE id = $1 FOR UPDATE`, [matchId]);
      const match = mRes.rows[0];
      if (!match) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: 'match_not_found', message: 'Match not found' });
      }
      if (seatNo < 0 || seatNo >= match.player_count) {
        await client.query('ROLLBACK');
        return reply.code(400).send({ error: 'invalid_seat', message: `seatNo must be 0..${match.player_count - 1}` });
      }

      const hRes = await client.query<{
        id: string;
        mark_revision: string;
        state: string;
      }>(`SELECT id, mark_revision, state FROM app.hands WHERE id = $1 AND match_id = $2 FOR UPDATE`, [handId, matchId]);
      const hand = hRes.rows[0];
      if (!hand) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: 'hand_not_found', message: 'Hand not found' });
      }
      if (hand.state !== 'open') {
        await client.query('ROLLBACK');
        return reply.code(409).send({ error: 'hand_not_open', message: 'Hand is already settled or voided' });
      }

      if (riichi) {
        const norm = normalizeRulesConfig(match.rules_snapshot, match.player_count);
        if (!norm.allowLowPointRiichi) {
          const balRes = await client.query<{ balance: number }>(
            `SELECT (a.opening_balance + COALESCE(SUM(e.amount), 0))::int AS balance
             FROM app.score_accounts a
             LEFT JOIN app.score_entries e ON e.account_id = a.id
             WHERE a.match_id = $1 AND a.kind = 'seat' AND a.seat_no = $2
             GROUP BY a.id, a.opening_balance`,
            [matchId, seatNo],
          );
          const seatBalance = balRes.rows[0]?.balance ?? norm.startingPoints;
          if (seatBalance < 1000) {
            await client.query('ROLLBACK');
            return reply.code(400).send({
              error: 'insufficient_points_for_riichi',
              message: `Seat ${seatNo} has ${seatBalance} points (< 1000)`,
            });
          }
        }
      }

      // Check idempotency per (hand_id, seat_no, principal_id)
      const existingMark = await client.query<{
        id: string;
        marked: boolean;
        updated_by: string;
      }>(
        `SELECT id, marked, updated_by
         FROM app.hand_riichi_marks
         WHERE hand_id = $1 AND seat_no = $2`,
        [handId, seatNo],
      );
      if (
        existingMark.rows[0] &&
        existingMark.rows[0].marked === riichi &&
        existingMark.rows[0].updated_by === principal.id &&
        Number(hand.mark_revision) > 0
      ) {
        await client.query('COMMIT');
        return { markRevision: Number(hand.mark_revision) };
      }

      const newSeq = Number(match.version) + 1;
      const newMarkRev = Number(hand.mark_revision) + 1;
      const reqHash = createHash('sha256')
        .update(`marks:${matchId}:${handId}:${seatNo}:${riichi}:${newMarkRev}`)
        .digest('hex');

      const evRes = await client.query<{ id: string }>(
        `INSERT INTO app.match_events (
           match_id, seq, hand_id, actor_principal_id, client_event_id, request_hash, type, payload
         )
         VALUES ($1, $2, $3, $4, $5, $6, 'marks_changed', $7::jsonb)
         RETURNING id`,
        [
          matchId,
          newSeq,
          handId,
          principal.id,
          randomUUID(),
          reqHash,
          JSON.stringify({ handId, seatNo, riichi, markRevision: newMarkRev }),
        ],
      );
      const eventId = evRes.rows[0].id;

      await client.query(
        `INSERT INTO app.hand_riichi_marks (
           match_id, hand_id, seat_no, marked, seat_revision, updated_by, last_event_id
         )
         VALUES ($1, $2, $3, $4, 1, $5, $6)
         ON CONFLICT (hand_id, seat_no)
         DO UPDATE SET
           marked = EXCLUDED.marked,
           seat_revision = app.hand_riichi_marks.seat_revision + 1,
           updated_by = EXCLUDED.updated_by,
           last_event_id = EXCLUDED.last_event_id,
           updated_at = now()`,
        [matchId, handId, seatNo, riichi, principal.id, eventId],
      );

      await client.query(
        `UPDATE app.hands SET mark_revision = $1 WHERE id = $2 AND match_id = $3`,
        [newMarkRev, handId, matchId],
      );
      await client.query(
        `UPDATE app.matches SET version = $1 WHERE id = $2`,
        [newSeq, matchId],
      );
      await client.query(
        `INSERT INTO app.outbox_messages (event_id, topic, payload, published_at)
         VALUES ($1, 'match_events', $2::jsonb, now())`,
        [eventId, JSON.stringify({ type: 'marks_changed', matchId, handId, seatNo, riichi, markRevision: newMarkRev })],
      );

      await client.query('COMMIT');

      broadcastMatchEvent(matchId, 'marks_changed', {
        matchId,
        handId,
        seatNo,
        riichi,
        markRevision: newMarkRev,
      });

      return { markRevision: newMarkRev };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  });

  // POST /api/matches/:id/hands/:handId/preview { resultInput } -> { perSeat, nextHand }
  app.post<{
    Params: { id: string; handId: string };
    Body: { resultInput?: Record<string, unknown> };
  }>('/api/matches/:id/hands/:handId/preview', async (req, reply) => {
    const principal = await requirePrincipal(req, reply);
    if (!principal) return;

    const { id: matchId, handId } = req.params;
    const access = await checkMatchAccess(matchId, principal.id);
    if (access === 'not_found') {
      return reply.code(404).send({ error: 'match_not_found', message: 'Match not found' });
    }
    if (access === 'forbidden') {
      return reply.code(403).send({ error: 'forbidden', message: 'Not a member of this match' });
    }

    const rawInput = (req.body?.resultInput ?? req.body) as Record<string, unknown> | undefined;
    if (!rawInput || typeof rawInput !== 'object') {
      return reply.code(400).send({ error: 'missing_result_input', message: 'resultInput is required' });
    }

    const mRes = await pool.query<{
      id: string;
      player_count: number;
      rules_snapshot: Record<string, unknown>;
      rules_hash: string;
      engine_version: string;
    }>(`SELECT id, player_count, rules_snapshot, rules_hash, engine_version FROM app.matches WHERE id = $1`, [matchId]);
    const match = mRes.rows[0];
    if (!match) {
      return reply.code(404).send({ error: 'match_not_found', message: 'Match not found' });
    }

    const hRes = await pool.query<{
      id: string;
      round_wind: 'E' | 'S' | 'W';
      round_number: number;
      dealer_seat_no: number;
      honba: number;
      riichi_pool_before: number;
      mark_revision: string;
      result_revision: string;
    }>(`SELECT * FROM app.hands WHERE id = $1 AND match_id = $2`, [handId, matchId]);
    const hand = hRes.rows[0];
    if (!hand) {
      return reply.code(404).send({ error: 'hand_not_found', message: 'Hand not found' });
    }

    const norm = normalizeRulesConfig(match.rules_snapshot, match.player_count);
    const balRes = await pool.query<{ seat_no: number; balance: number }>(
      `SELECT a.seat_no, (a.opening_balance + COALESCE(SUM(e.amount), 0))::int AS balance
       FROM app.score_accounts a
       LEFT JOIN app.score_entries e ON e.account_id = a.id
       WHERE a.match_id = $1 AND a.kind = 'seat'
       GROUP BY a.id, a.seat_no, a.opening_balance
       ORDER BY a.seat_no ASC`,
      [matchId],
    );
    const balanceBySeat: Record<number, number> = {};
    for (const r of balRes.rows) {
      balanceBySeat[r.seat_no] = r.balance;
    }

    const marksRes = await pool.query<{ seat_no: number; marked: boolean }>(
      `SELECT seat_no, marked FROM app.hand_riichi_marks WHERE hand_id = $1 AND marked = true`,
      [handId],
    );
    const riichiBySeat: Record<number, true> = {};
    for (const r of marksRes.rows) {
      if (r.marked) riichiBySeat[r.seat_no] = true;
    }

    const handState: HandState = {
      handId: hand.id,
      roundWind: hand.round_wind,
      roundNumber: hand.round_number,
      dealerSeatNo: hand.dealer_seat_no,
      honba: hand.honba,
      riichiPool: hand.riichi_pool_before,
      markRevision: BigInt(hand.mark_revision),
      resultRevision: BigInt(hand.result_revision),
      seats: Array.from({ length: match.player_count }, (_, seatNo) => ({
        seatNo,
        points: balanceBySeat[seatNo] ?? norm.startingPoints,
        isRiichi: Boolean(riichiBySeat[seatNo]),
        isTenpai: null,
      })),
    };

    try {
      const normalizedInput = normalizeIncomingResultInput(rawInput);
      const output = calculateSettlement(
        { rulesHash: match.rules_hash, config: match.rules_snapshot },
        handState,
        normalizedInput,
        match.engine_version,
      );
      return {
        perSeat: output.perSeat,
        nextHand: output.nextHand,
      };
    } catch (err) {
      return reply.code(400).send({
        error: 'engine_calculation_error',
        message: err instanceof Error ? err.message : 'Invalid resultInput',
      });
    }
  });

  // POST /api/matches/:id/hands/:handId/results { resultInput, confirmedMarkRevision } -> { perSeat, nextHand }
  app.post<{
    Params: { id: string; handId: string };
    Body: {
      resultInput?: Record<string, unknown>;
      confirmedMarkRevision?: number | string;
    };
  }>('/api/matches/:id/hands/:handId/results', async (req, reply) => {
    const principal = await requirePrincipal(req, reply);
    if (!principal) return;

    const { id: matchId, handId } = req.params;
    const access = await checkMatchAccess(matchId, principal.id);
    if (access === 'not_found') {
      return reply.code(404).send({ error: 'match_not_found', message: 'Match not found' });
    }
    if (access === 'forbidden') {
      return reply.code(403).send({ error: 'forbidden', message: 'Not a member of this match' });
    }

    const rawInput = req.body?.resultInput;
    const confirmedMarkRevision = req.body?.confirmedMarkRevision;
    if (!rawInput || typeof rawInput !== 'object') {
      return reply.code(400).send({ error: 'missing_result_input', message: 'resultInput is required' });
    }
    if (confirmedMarkRevision === undefined || confirmedMarkRevision === null) {
      return reply.code(400).send({ error: 'missing_mark_revision', message: 'confirmedMarkRevision is required' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Lock principal FOR SHARE
      await client.query(`SELECT id FROM app.principals WHERE id = $1 FOR SHARE`, [principal.id]);

      // 2. Lock match FOR UPDATE
      const mRes = await client.query<{
        id: string;
        player_count: number;
        rules_snapshot: Record<string, unknown>;
        rules_hash: string;
        engine_version: string;
        state: string;
        version: string;
      }>(`SELECT * FROM app.matches WHERE id = $1 FOR UPDATE`, [matchId]);
      const match = mRes.rows[0];
      if (!match) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: 'match_not_found', message: 'Match not found' });
      }
      if (match.state !== 'active') {
        await client.query('ROLLBACK');
        return reply.code(409).send({ error: 'match_not_active', message: 'Match is not active' });
      }

      // 3. Lock hand FOR UPDATE
      const hRes = await client.query<{
        id: string;
        hand_no: number;
        round_wind: 'E' | 'S' | 'W';
        round_number: number;
        dealer_seat_no: number;
        honba: number;
        riichi_pool_before: number;
        mark_revision: string;
        result_revision: string;
        state: string;
      }>(`SELECT * FROM app.hands WHERE id = $1 AND match_id = $2 FOR UPDATE`, [handId, matchId]);
      const hand = hRes.rows[0];
      if (!hand) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: 'hand_not_found', message: 'Hand not found' });
      }

      // Guard re-settle (unique index uq_active_hand_result + state check)
      const existingResult = await client.query<{ id: string }>(
        `SELECT id FROM app.hand_results WHERE hand_id = $1 AND superseded_at IS NULL`,
        [handId],
      );
      if (hand.state !== 'open' || (existingResult.rowCount ?? 0) > 0) {
        await client.query('ROLLBACK');
        return reply.code(409).send({ error: 'hand_already_settled', message: 'Hand has already been settled' });
      }

      // Validate confirmedMarkRevision == current markRevision
      if (Number(confirmedMarkRevision) !== Number(hand.mark_revision)) {
        await client.query('ROLLBACK');
        return reply.code(409).send({
          error: 'mark_revision_mismatch',
          message: `confirmedMarkRevision (${confirmedMarkRevision}) does not match current markRevision (${hand.mark_revision})`,
          currentMarkRevision: Number(hand.mark_revision),
        });
      }

      // Load score accounts & current balances
      const accRes = await client.query<{
        id: string;
        kind: string;
        seat_no: number | null;
        balance: number;
      }>(
        `SELECT
           a.id,
           a.kind,
           a.seat_no,
           (a.opening_balance + COALESCE(SUM(e.amount), 0))::int AS balance
         FROM app.score_accounts a
         LEFT JOIN app.score_entries e ON e.account_id = a.id
         WHERE a.match_id = $1
         GROUP BY a.id, a.kind, a.seat_no, a.opening_balance
         ORDER BY a.seat_no ASC NULLS LAST`,
        [matchId],
      );

      const seatAccountBySeat: Record<number, { id: string; balance: number }> = {};
      let riichiPoolAccountId: string | null = null;
      for (const r of accRes.rows) {
        if (r.kind === 'seat' && r.seat_no !== null) {
          seatAccountBySeat[r.seat_no] = { id: r.id, balance: r.balance };
        } else if (r.kind === 'riichi_pool') {
          riichiPoolAccountId = r.id;
        }
      }
      if (!riichiPoolAccountId) {
        await client.query('ROLLBACK');
        return reply.code(500).send({ error: 'missing_pool_account', message: 'Riichi pool score account missing' });
      }

      // Load active seat assignments
      const saRes = await client.query<{ id: string; seat_no: number }>(
        `SELECT id, seat_no FROM app.seat_assignments WHERE match_id = $1 AND end_hand_no IS NULL ORDER BY seat_no ASC`,
        [matchId],
      );
      const seatAssignmentBySeat: Record<number, string> = {};
      for (const r of saRes.rows) {
        seatAssignmentBySeat[r.seat_no] = r.id;
      }

      // Load riichi marks
      const marksRes = await client.query<{ seat_no: number; marked: boolean }>(
        `SELECT seat_no, marked FROM app.hand_riichi_marks WHERE hand_id = $1 AND marked = true`,
        [handId],
      );
      const riichiBySeat: Record<number, true> = {};
      for (const r of marksRes.rows) {
        if (r.marked) riichiBySeat[r.seat_no] = true;
      }

      const norm = normalizeRulesConfig(match.rules_snapshot, match.player_count);
      const handState: HandState = {
        handId: hand.id,
        roundWind: hand.round_wind,
        roundNumber: hand.round_number,
        dealerSeatNo: hand.dealer_seat_no,
        honba: hand.honba,
        riichiPool: hand.riichi_pool_before,
        markRevision: BigInt(hand.mark_revision),
        resultRevision: BigInt(hand.result_revision),
        seats: Array.from({ length: match.player_count }, (_, seatNo) => ({
          seatNo,
          points: seatAccountBySeat[seatNo]?.balance ?? norm.startingPoints,
          isRiichi: Boolean(riichiBySeat[seatNo]),
          isTenpai: null,
        })),
      };

      let normalizedInput: ResultInput;
      let output: SettlementOutput;
      try {
        normalizedInput = normalizeIncomingResultInput(rawInput);
        output = calculateSettlement(
          { rulesHash: match.rules_hash, config: match.rules_snapshot },
          handState,
          normalizedInput,
          match.engine_version,
        );
      } catch (err) {
        await client.query('ROLLBACK');
        return reply.code(400).send({
          error: 'engine_calculation_error',
          message: err instanceof Error ? err.message : 'Invalid resultInput',
        });
      }

      const newResultRevision = Number(hand.result_revision) + 1;
      const inputMode = normalizedInput.manualPayments ? 'manual_adjustment' : 'han_fu';

      // Insert hand_results
      const hrRes = await client.query<{ id: string }>(
        `INSERT INTO app.hand_results (
           match_id,
           hand_id,
           revision,
           kind,
           confirmed_mark_revision,
           input_mode,
           input,
           calculation,
           engine_version,
           created_by
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10)
         RETURNING id`,
        [
          matchId,
          handId,
          newResultRevision,
          normalizedInput.kind,
          Number(hand.mark_revision),
          inputMode,
          JSON.stringify(normalizedInput),
          JSON.stringify(output),
          match.engine_version,
          principal.id,
        ],
      );
      const resultId = hrRes.rows[0].id;

      // Insert hand_seat_outcomes (must precede result_winners due to FK)
      for (let i = 0; i < output.perSeat.length; i++) {
        const sp = output.perSeat[i];
        const stoodRiichi = sp.breakdown.some((b) => b.reason === 'riichi');
        const isTenpai =
          normalizedInput.kind === 'ryuukyoku' && Array.isArray(normalizedInput.tenpai)
            ? Boolean(normalizedInput.tenpai[i])
            : null;
        const isNagashi =
          normalizedInput.kind === 'nagashi_mangan' &&
          normalizedInput.winners.some((w) => w.seatNo === sp.seatNo);
        const chomboRole = normalizedInput.chomboRole?.[sp.seatNo] ?? null;

        await client.query(
          `INSERT INTO app.hand_seat_outcomes (
             result_id,
             match_id,
             seat_no,
             seat_assignment_id,
             is_riichi,
             is_tenpai,
             is_nagashi_mangan,
             chombo_role,
             net_points
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            resultId,
            matchId,
            sp.seatNo,
            seatAssignmentBySeat[sp.seatNo],
            stoodRiichi,
            isTenpai,
            isNagashi,
            chomboRole,
            sp.netPoints,
          ],
        );
      }

      // Insert result_winners
      if (
        (normalizedInput.kind === 'ron' ||
          normalizedInput.kind === 'tsumo' ||
          normalizedInput.kind === 'nagashi_mangan') &&
        Array.isArray(normalizedInput.winners)
      ) {
        for (const w of normalizedInput.winners) {
          const fuVal =
            typeof w.fu === 'number' && w.fu >= 20 && w.fu <= 140 ? w.fu : null;
          const dealIn =
            normalizedInput.kind === 'ron' && typeof w.dealInSeatNo === 'number'
              ? w.dealInSeatNo
              : null;
          await client.query(
            `INSERT INTO app.result_winners (
               result_id, seat_no, han, fu, yakuman_count, deal_in_seat_no
             )
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [resultId, w.seatNo, w.han ?? 0, fuVal, w.yakumanCount ?? 0, dealIn],
          );
        }
      }

      // Insert match_events
      const newSeq = Number(match.version) + 1;
      const reqHash = createHash('sha256')
        .update(JSON.stringify({ matchId, handId, resultInput: normalizedInput, confirmedMarkRevision }))
        .digest('hex');

      const evRes = await client.query<{ id: string }>(
        `INSERT INTO app.match_events (
           match_id, seq, hand_id, actor_principal_id, client_event_id, request_hash, type, payload
         )
         VALUES ($1, $2, $3, $4, $5, $6, 'hand_settled', $7::jsonb)
         RETURNING id`,
        [
          matchId,
          newSeq,
          handId,
          principal.id,
          randomUUID(),
          reqHash,
          JSON.stringify({
            handId,
            resultId,
            perSeat: output.perSeat,
            nextHand: output.nextHand,
          }),
        ],
      );
      const eventId = evRes.rows[0].id;

      // Insert score_entries following the §6.3 ledger pattern:
      // 1. Confirmed riichi sticks: -1000 on seat account, +1000 on riichi_pool account
      for (const sp of output.perSeat) {
        const seatAcc = seatAccountBySeat[sp.seatNo];
        for (const item of sp.breakdown) {
          if (item.reason === 'riichi' && item.amount !== 0) {
            await client.query(
              `INSERT INTO app.score_entries (match_id, event_id, account_id, amount, reason)
               VALUES ($1, $2, $3, $4, 'riichi'),
                      ($1, $2, $5, $6, 'riichi_pool_in')`,
              [matchId, eventId, seatAcc.id, item.amount, riichiPoolAccountId, -item.amount],
            );
          }
        }
      }

      // 2. Direct hand payments (ron, tsumo, honba, tenpai/noten, nagashi, manual)
      for (const sp of output.perSeat) {
        const seatAcc = seatAccountBySeat[sp.seatNo];
        for (const item of sp.breakdown) {
          if (item.reason !== 'riichi' && item.reason !== 'riichi_pool' && item.amount !== 0) {
            await client.query(
              `INSERT INTO app.score_entries (match_id, event_id, account_id, amount, reason)
               VALUES ($1, $2, $3, $4, $5)`,
              [matchId, eventId, seatAcc.id, item.amount, item.reason],
            );
          }
        }
      }

      // 3. Riichi pool distribution to winner: -pool on riichi_pool account, +pool on winner seat account
      for (const sp of output.perSeat) {
        const seatAcc = seatAccountBySeat[sp.seatNo];
        for (const item of sp.breakdown) {
          if (item.reason === 'riichi_pool' && item.amount !== 0) {
            await client.query(
              `INSERT INTO app.score_entries (match_id, event_id, account_id, amount, reason)
               VALUES ($1, $2, $3, $4, 'riichi_pool_out'),
                      ($1, $2, $5, $6, 'riichi_pool')`,
              [matchId, eventId, riichiPoolAccountId, -item.amount, seatAcc.id, item.amount],
            );
          }
        }
      }

      // Update hand state & result_revision
      await client.query(
        `UPDATE app.hands
         SET state = 'settled',
             result_revision = $1
         WHERE id = $2 AND match_id = $3`,
        [newResultRevision, handId, matchId],
      );

      // Update match version
      await client.query(
        `UPDATE app.matches SET version = $1 WHERE id = $2`,
        [newSeq, matchId],
      );

      // Write match_snapshots
      const snapshotState = {
        handId,
        resultId,
        seats: output.perSeat.map((sp) => ({
          seatNo: sp.seatNo,
          points: (seatAccountBySeat[sp.seatNo]?.balance ?? norm.startingPoints) + sp.netPoints,
        })),
        nextHand: output.nextHand,
      };
      const stateHash = createHash('sha256').update(JSON.stringify(snapshotState)).digest('hex');
      await client.query(
        `INSERT INTO app.match_snapshots (match_id, seq, state, engine_version, state_hash)
         VALUES ($1, $2, $3::jsonb, $4, $5)`,
        [matchId, newSeq, JSON.stringify(snapshotState), match.engine_version, stateHash],
      );

      // Write outbox_messages
      await client.query(
        `INSERT INTO app.outbox_messages (event_id, topic, payload, published_at)
         VALUES ($1, 'match_events', $2::jsonb, now())`,
        [
          eventId,
          JSON.stringify({
            type: 'hand_settled',
            matchId,
            handId,
            perSeat: output.perSeat,
            nextHand: output.nextHand,
          }),
        ],
      );

      await client.query('COMMIT');

      broadcastMatchEvent(matchId, 'hand_settled', {
        matchId,
        handId,
        perSeat: output.perSeat,
        nextHand: output.nextHand,
      });

      return {
        perSeat: output.perSeat,
        nextHand: output.nextHand,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      if (err && typeof err === 'object' && 'code' in err && err.code === '23505') {
        return reply.code(409).send({ error: 'hand_already_settled', message: 'Hand has already been settled' });
      }
      throw err;
    } finally {
      client.release();
    }
  });

  // GET /api/matches/:id/hands?limit=20 -> [{ handId, kind, perSeat summary }]
  app.get<{
    Params: { id: string };
    Querystring: { limit?: string };
  }>('/api/matches/:id/hands', async (req, reply) => {
    const principal = await requirePrincipal(req, reply);
    if (!principal) return;

    const matchId = req.params.id;
    const access = await checkMatchAccess(matchId, principal.id);
    if (access === 'not_found') {
      return reply.code(404).send({ error: 'match_not_found', message: 'Match not found' });
    }
    if (access === 'forbidden') {
      return reply.code(403).send({ error: 'forbidden', message: 'Not a member of this match' });
    }

    const rawLimit = Number(req.query?.limit ?? 20);
    const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 100) : 20;

    const res = await pool.query<{
      hand_id: string;
      hand_no: number;
      round_wind: string;
      round_number: number;
      dealer_seat_no: number;
      honba: number;
      kind: string;
      calculation: { perSeat?: unknown[] };
    }>(
      `SELECT
         h.id AS hand_id,
         h.hand_no,
         h.round_wind,
         h.round_number,
         h.dealer_seat_no,
         h.honba,
         hr.kind,
         hr.calculation
       FROM app.hands h
       JOIN app.hand_results hr ON hr.hand_id = h.id AND hr.superseded_at IS NULL
       WHERE h.match_id = $1
       ORDER BY h.hand_no ASC
       LIMIT $2`,
      [matchId, limit],
    );

    return res.rows.map((r) => ({
      handId: r.hand_id,
      handNo: r.hand_no,
      roundWind: r.round_wind,
      roundNumber: r.round_number,
      dealerSeatNo: r.dealer_seat_no,
      honba: r.honba,
      kind: r.kind,
      perSeat: r.calculation?.perSeat ?? [],
    }));
  });

  // POST /api/matches/:id/finish {} -> { finished: true, provisionalRankings }
  app.post<{ Params: { id: string } }>('/api/matches/:id/finish', async (req, reply) => {
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
        return reply.code(403).send({ error: 'forbidden', message: 'Only the match owner can finish the match' });
      }
      if (match.state !== 'active') {
        await client.query('ROLLBACK');
        return reply.code(409).send({ error: 'match_not_active', message: 'Match is not active' });
      }

      // Void any unsettled open hand
      await client.query(
        `UPDATE app.hands SET state = 'voided' WHERE match_id = $1 AND state = 'open'`,
        [matchId],
      );

      // Query current balances and seat principals
      const accRes = await client.query<{
        id: string;
        kind: string;
        seat_no: number | null;
        balance: number;
        principal_id: string | null;
      }>(
        `SELECT
           a.id,
           a.kind,
           a.seat_no,
           (a.opening_balance + COALESCE(SUM(e.amount), 0))::int AS balance,
           mm.principal_id
         FROM app.score_accounts a
         LEFT JOIN app.score_entries e ON e.account_id = a.id
         LEFT JOIN app.seat_assignments sa
           ON sa.match_id = a.match_id AND sa.seat_no = a.seat_no AND sa.end_hand_no IS NULL
         LEFT JOIN app.match_members mm
           ON mm.match_id = sa.match_id AND mm.id = sa.member_id
         WHERE a.match_id = $1
         GROUP BY a.id, a.kind, a.seat_no, a.opening_balance, mm.principal_id
         ORDER BY a.seat_no ASC NULLS LAST`,
        [matchId],
      );

      const seatAccounts: {
        accountId: string;
        seatNo: number;
        rawPoints: number;
        principalId: string | null;
      }[] = [];
      let riichiPoolAccount: { accountId: string; balance: number } | null = null;

      for (const r of accRes.rows) {
        if (r.kind === 'seat' && r.seat_no !== null) {
          seatAccounts.push({
            accountId: r.id,
            seatNo: r.seat_no,
            rawPoints: r.balance,
            principalId: r.principal_id,
          });
        } else if (r.kind === 'riichi_pool') {
          riichiPoolAccount = { accountId: r.id, balance: r.balance };
        }
      }

      const residualPool = riichiPoolAccount?.balance ?? 0;

      // Provisional ranking by rawPoints descending, tie-breaking by fixed initial seat order (0, 1, 2, 3) per docs §4.5
      const sortedByRaw = [...seatAccounts].sort((a, b) => {
        if (b.rawPoints !== a.rawPoints) return b.rawPoints - a.rawPoints;
        return a.seatNo - b.seatNo;
      });

      const topSeatNo = sortedByRaw[0].seatNo;
      const topSeatAccountId = sortedByRaw[0].accountId;

      // Apply residual riichiPool to provisional #1 and re-rank if needed
      const withFinalPoints = seatAccounts.map((s) => ({
        ...s,
        finalPoints: s.rawPoints + (s.seatNo === topSeatNo ? residualPool : 0),
      }));
      const finalSorted = [...withFinalPoints].sort((a, b) => {
        if (b.finalPoints !== a.finalPoints) return b.finalPoints - a.finalPoints;
        return a.seatNo - b.seatNo;
      });

      const provisionalRankings = finalSorted.map((s, idx) => ({
        rank: idx + 1,
        seatNo: s.seatNo,
        principalId: s.principalId,
        rawPoints: s.rawPoints,
        points: s.finalPoints,
        finalPoints: s.finalPoints,
      }));

      const newSeq = Number(match.version) + 1;
      const reqHash = createHash('sha256').update(`match_finished:${matchId}`).digest('hex');
      const evRes = await client.query<{ id: string }>(
        `INSERT INTO app.match_events (
           match_id, seq, hand_id, actor_principal_id, client_event_id, request_hash, type, payload
         )
         VALUES ($1, $2, NULL, $3, $4, $5, 'match_finished', $6::jsonb)
         RETURNING id`,
        [
          matchId,
          newSeq,
          principal.id,
          randomUUID(),
          reqHash,
          JSON.stringify({
            unclaimedRiichiPoints: residualPool,
            poolRecipientSeatNo: topSeatNo,
            provisionalRankings,
          }),
        ],
      );
      const eventId = evRes.rows[0].id;

      // If residual riichiPool > 0, transfer it in score_entries to provisional #1
      if (residualPool > 0 && riichiPoolAccount) {
        await client.query(
          `INSERT INTO app.score_entries (match_id, event_id, account_id, amount, reason)
           VALUES ($1, $2, $3, $4, 'terminal_riichi_pool_out'),
                  ($1, $2, $5, $6, 'terminal_riichi_pool')`,
          [matchId, eventId, riichiPoolAccount.accountId, -residualPool, topSeatAccountId, residualPool],
        );
      }

      await client.query(
        `UPDATE app.matches
         SET state = 'finished',
             ended_at = now(),
             version = $1
         WHERE id = $2`,
        [newSeq, matchId],
      );

      await client.query(
        `INSERT INTO app.outbox_messages (event_id, topic, payload, published_at)
         VALUES ($1, 'match_events', $2::jsonb, now())`,
        [eventId, JSON.stringify({ type: 'match_finished', matchId, finished: true, provisionalRankings })],
      );

      await client.query('COMMIT');

      broadcastMatchEvent(matchId, 'match_finished', {
        matchId,
        finished: true,
        provisionalRankings,
      });

      return {
        finished: true,
        provisionalRankings,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  });

  // GET /api/matches/:id/settlement/preview -> { terminalTenths }
  app.get<{ Params: { id: string } }>('/api/matches/:id/settlement/preview', async (req, reply) => {
    const principal = await requirePrincipal(req, reply);
    if (!principal) return;

    const matchId = req.params.id;
    const access = await checkMatchAccess(matchId, principal.id);
    if (access === 'not_found') {
      return reply.code(404).send({ error: 'match_not_found', message: 'Match not found' });
    }
    if (access === 'forbidden') {
      return reply.code(403).send({ error: 'forbidden', message: 'Not a member of this match' });
    }

    const mRes = await pool.query<{
      id: string;
      player_count: number;
      rules_snapshot: Record<string, unknown>;
      rules_hash: string;
    }>(`SELECT id, player_count, rules_snapshot, rules_hash FROM app.matches WHERE id = $1`, [matchId]);
    const match = mRes.rows[0];
    if (!match) {
      return reply.code(404).send({ error: 'match_not_found', message: 'Match not found' });
    }

    const accRes = await pool.query<{
      kind: string;
      seat_no: number | null;
      balance: number;
    }>(
      `SELECT
         a.kind,
         a.seat_no,
         (a.opening_balance + COALESCE(SUM(e.amount), 0))::int AS balance
       FROM app.score_accounts a
       LEFT JOIN app.score_entries e ON e.account_id = a.id
       WHERE a.match_id = $1
       GROUP BY a.id, a.kind, a.seat_no, a.opening_balance
       ORDER BY a.seat_no ASC NULLS LAST`,
      [matchId],
    );

    const seatEntries: { seatNo: number; points: number }[] = [];
    let poolBalance = 0;
    for (const r of accRes.rows) {
      if (r.kind === 'seat' && r.seat_no !== null) {
        seatEntries.push({ seatNo: r.seat_no, points: r.balance });
      } else if (r.kind === 'riichi_pool') {
        poolBalance = r.balance;
      }
    }

    const terminal = calculateTerminalSettlement(
      seatEntries,
      { rulesHash: match.rules_hash, config: match.rules_snapshot },
      { riichiPool: poolBalance },
    );

    return {
      terminalTenths: terminal.tenths,
      perSeat: terminal.perSeat,
      standings: terminal.standings,
    };
  });

  // POST /api/matches/:id/settlement/confirm {} -> { settlementId }
  app.post<{ Params: { id: string } }>('/api/matches/:id/settlement/confirm', async (req, reply) => {
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
        return reply.code(403).send({ error: 'forbidden', message: 'Only the match owner can confirm settlement' });
      }
      if (match.state !== 'finished') {
        await client.query('ROLLBACK');
        return reply.code(409).send({ error: 'match_not_finished', message: 'Match must be finished before confirming settlement' });
      }

      const existingSettle = await client.query<{ id: string }>(
        `SELECT id FROM app.settlements WHERE match_id = $1 AND superseded_at IS NULL`,
        [matchId],
      );
      if (existingSettle.rows[0]) {
        await client.query('ROLLBACK');
        return reply.code(409).send({ error: 'settlement_already_confirmed', message: 'Settlement is already confirmed' });
      }

      // Query current balances and seat occupants
      const accRes = await client.query<{
        kind: string;
        seat_no: number | null;
        balance: number;
        seat_assignment_id: string | null;
        principal_id: string | null;
      }>(
        `SELECT
           a.kind,
           a.seat_no,
           (a.opening_balance + COALESCE(SUM(e.amount), 0))::int AS balance,
           sa.id AS seat_assignment_id,
           mm.principal_id
         FROM app.score_accounts a
         LEFT JOIN app.score_entries e ON e.account_id = a.id
         LEFT JOIN app.seat_assignments sa
           ON sa.match_id = a.match_id AND sa.seat_no = a.seat_no AND sa.end_hand_no IS NULL
         LEFT JOIN app.match_members mm
           ON mm.match_id = sa.match_id AND mm.id = sa.member_id
         WHERE a.match_id = $1
         GROUP BY a.id, a.kind, a.seat_no, a.opening_balance, sa.id, mm.principal_id
         ORDER BY a.seat_no ASC NULLS LAST`,
        [matchId],
      );

      const seatEntries: {
        seatNo: number;
        points: number;
        seatAssignmentId: string;
        principalId: string;
      }[] = [];
      let poolBalance = 0;

      for (const r of accRes.rows) {
        if (r.kind === 'seat' && r.seat_no !== null && r.principal_id && r.seat_assignment_id) {
          seatEntries.push({
            seatNo: r.seat_no,
            points: r.balance,
            seatAssignmentId: r.seat_assignment_id,
            principalId: r.principal_id,
          });
        } else if (r.kind === 'riichi_pool') {
          poolBalance = r.balance;
        }
      }

      // Check unclaimed_riichi_points recorded when finishing the match
      const finishEvRes = await client.query<{
        payload: { unclaimedRiichiPoints?: number };
      }>(
        `SELECT payload FROM app.match_events
         WHERE match_id = $1 AND type = 'match_finished'
         ORDER BY seq DESC LIMIT 1`,
        [matchId],
      );
      const unclaimedRiichiPoints =
        finishEvRes.rows[0]?.payload?.unclaimedRiichiPoints ?? poolBalance;

      const terminal = calculateTerminalSettlement(
        seatEntries.map((s) => ({ seatNo: s.seatNo, points: s.points })),
        { rulesHash: match.rules_hash, config: match.rules_snapshot },
        { riichiPool: poolBalance },
      );

      const newSeq = Number(match.version) + 1;
      const reqHash = createHash('sha256').update(`settlement_confirmed:${matchId}`).digest('hex');

      const evRes = await client.query<{ id: string }>(
        `INSERT INTO app.match_events (
           match_id, seq, hand_id, actor_principal_id, client_event_id, request_hash, type, payload
         )
         VALUES ($1, $2, NULL, $3, $4, $5, 'settlement_confirmed', $6::jsonb)
         RETURNING id`,
        [
          matchId,
          newSeq,
          principal.id,
          randomUUID(),
          reqHash,
          JSON.stringify({ standings: terminal.standings }),
        ],
      );
      const eventId = evRes.rows[0].id;

      const sRes = await client.query<{ id: string }>(
        `INSERT INTO app.settlements (
           match_id, revision, source_seq, unclaimed_riichi_points
         )
         VALUES ($1, 1, $2, $3)
         RETURNING id`,
        [matchId, newSeq, unclaimedRiichiPoints],
      );
      const settlementId = sRes.rows[0].id;

      const handCountRes = await client.query<{ cnt: number }>(
        `SELECT COUNT(*)::int AS cnt FROM app.hands WHERE match_id = $1 AND state = 'settled'`,
        [matchId],
      );
      const handsPlayed = handCountRes.rows[0]?.cnt ?? 0;

      for (const sp of terminal.perSeat) {
        const meta = seatEntries.find((s) => s.seatNo === sp.seatNo)!;
        await client.query(
          `INSERT INTO app.settlement_players (
             settlement_id,
             match_id,
             seat_no,
             principal_id,
             final_points,
             rank,
             uma_tenths,
             oka_tenths,
             penalty_tenths,
             total_tenths
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            settlementId,
            matchId,
            sp.seatNo,
            meta.principalId,
            sp.finalPoints,
            sp.rank,
            sp.umaTenths,
            sp.okaTenths,
            sp.penaltyTenths,
            sp.totalTenths,
          ],
        );

        await client.query(
          `INSERT INTO app.settlement_participations (
             settlement_id, match_id, seat_assignment_id, principal_id, hands_played, full_match
           )
           VALUES ($1, $2, $3, $4, $5, true)`,
          [settlementId, matchId, meta.seatAssignmentId, meta.principalId, handsPlayed],
        );
      }

      const ownerMemRes = await client.query<{ id: string }>(
        `SELECT id FROM app.match_members WHERE match_id = $1 AND principal_id = $2`,
        [matchId, principal.id],
      );
      if (ownerMemRes.rows[0]) {
        await client.query(
          `INSERT INTO app.settlement_confirmations (settlement_id, match_id, member_id, status)
           VALUES ($1, $2, $3, 'confirmed')`,
          [settlementId, matchId, ownerMemRes.rows[0].id],
        );
      }

      await client.query(
        `UPDATE app.matches SET version = $1 WHERE id = $2`,
        [newSeq, matchId],
      );

      await client.query(
        `INSERT INTO app.outbox_messages (event_id, topic, payload, published_at)
         VALUES ($1, 'match_events', $2::jsonb, now())`,
        [
          eventId,
          JSON.stringify({
            type: 'settlement_confirmed',
            matchId,
            settlementId,
            standings: terminal.standings,
          }),
        ],
      );

      await client.query('COMMIT');

      broadcastMatchEvent(matchId, 'settlement_confirmed', {
        matchId,
        settlementId,
        standings: terminal.standings,
      });

      return { settlementId };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  });
}
