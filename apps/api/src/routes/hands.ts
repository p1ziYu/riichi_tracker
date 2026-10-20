import { createHash, randomUUID } from 'node:crypto';
import {
  calculateSettlement,
  calculateTerminalSettlement,
  isAutomaticMatchEnd,
  normalizeRulesConfig,
  type EngineRulesConfig,
  type HandState,
  type ResultInput,
  type SettlementOutput,
  type WinnerInput,
} from '@riichi/engine';
import type { FastifyInstance } from 'fastify';
import type { PoolClient } from 'pg';
import { requirePrincipal } from '../auth.js';
import { pool } from '../db.js';
import { broadcastMatchEvent } from '../ws.js';
import { checkConfirmedParticipantWriteAccess, checkMatchAccess } from './matches.js';
import { prepareEngineRulesConfig } from './rulesets.js';

class ResultValidationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const VALID_RESULT_KINDS: Record<string, true> = {
  ron: true,
  tsumo: true,
  ryuukyoku: true,
  chombo: true,
  nagashi_mangan: true,
};

const EFFECTIVE_WIN_REASONS: Record<string, true> = {
  ron_win: true,
  tsumo_win: true,
  nagashi_mangan_win: true,
};

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SOUTH4_COMPLETION_SQL = `
  SELECT h.state = 'settled' AND h.round_wind = 'S' AND h.round_number = 4
    AND hr.calculation->'nextHand'->>'roundWind' = 'W'
    AND hr.calculation->'nextHand'->>'roundNumber' = '1' AS complete
  FROM app.hands h
  LEFT JOIN app.hand_results hr ON hr.hand_id = h.id AND hr.superseded_at IS NULL
  WHERE h.match_id = $1
  ORDER BY h.hand_no DESC LIMIT 1`;


function resolveClientEventUuid(rawClientEventId: string): string {
  const trimmed = rawClientEventId.trim();
  if (UUID_REGEX.test(trimmed)) {
    return trimmed.toLowerCase();
  }
  const h = createHash('sha256').update(`client_event_id:${trimmed}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

function validateAndNormalizeResultInput(
  raw: unknown,
  playerCount: number,
  handState: HandState,
  config: EngineRulesConfig,
): ResultInput {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ResultValidationError('invalid_result_input', 'resultInput must be an object');
  }
  const rawObj = raw as Record<string, unknown>;
  if (typeof rawObj.kind !== 'string' || !VALID_RESULT_KINDS[rawObj.kind]) {
    throw new ResultValidationError('invalid_result_kind', 'Invalid resultInput.kind');
  }
  const kind = rawObj.kind as ResultInput['kind'];

  if (
    rawObj.dealInSeatNo !== undefined &&
    rawObj.dealInSeatNo !== null &&
    (typeof rawObj.dealInSeatNo !== 'number' ||
      !Number.isInteger(rawObj.dealInSeatNo) ||
      rawObj.dealInSeatNo < 0 ||
      rawObj.dealInSeatNo >= playerCount)
  ) {
    throw new ResultValidationError('invalid_deal_in_seat', 'Invalid dealInSeatNo');
  }
  const topDealIn = typeof rawObj.dealInSeatNo === 'number' ? rawObj.dealInSeatNo : null;

  if (
    rawObj.isRiichiDeclarationDealIn !== undefined &&
    typeof rawObj.isRiichiDeclarationDealIn !== 'boolean'
  ) {
    throw new ResultValidationError(
      'invalid_riichi_declaration_deal_in',
      'isRiichiDeclarationDealIn must be a boolean',
    );
  }
  const topRiichiDealIn =
    typeof rawObj.isRiichiDeclarationDealIn === 'boolean'
      ? rawObj.isRiichiDeclarationDealIn
      : undefined;

  let rawWinners: unknown[] = [];
  if (rawObj.winners !== undefined && rawObj.winners !== null) {
    if (!Array.isArray(rawObj.winners)) {
      throw new ResultValidationError('invalid_winners', 'winners must be an array');
    }
    rawWinners = rawObj.winners;
  } else if (rawObj.winnerSeatNo !== undefined || rawObj.seatNo !== undefined) {
    rawWinners = [
      {
        seatNo: rawObj.winnerSeatNo ?? rawObj.seatNo,
        han: rawObj.han,
        fu: rawObj.fu,
        yakumanCount: rawObj.yakumanCount,
        doubleYakumanCount: rawObj.doubleYakumanCount,
        dealInSeatNo: topDealIn,
        isRiichiDeclarationDealIn: topRiichiDealIn,
      },
    ];
  }

  if (kind === 'ron') {
    if (rawWinners.length < 1 || rawWinners.length >= playerCount) {
      throw new ResultValidationError(
        'invalid_winners',
        `ron requires between 1 and ${playerCount - 1} winners`,
      );
    }
  } else if (kind === 'tsumo') {
    if (rawWinners.length !== 1) {
      throw new ResultValidationError('invalid_winners', 'tsumo requires exactly 1 winner');
    }
    if (topDealIn !== null) {
      throw new ResultValidationError('invalid_deal_in_seat', 'tsumo must not specify dealInSeatNo');
    }
  } else if (kind === 'nagashi_mangan') {
    if (rawWinners.length < 1 || rawWinners.length > playerCount) {
      throw new ResultValidationError('invalid_winners', 'nagashi_mangan requires at least 1 winner');
    }
    if (topDealIn !== null) {
      throw new ResultValidationError('invalid_deal_in_seat', 'nagashi_mangan must not specify dealInSeatNo');
    }
  } else {
    if (rawWinners.length > 0) {
      throw new ResultValidationError('invalid_winners', `${kind} must not have winners`);
    }
    if (topDealIn !== null) {
      throw new ResultValidationError('invalid_deal_in_seat', `${kind} must not specify dealInSeatNo`);
    }
  }

  let nagashiEligibility: ResultInput['nagashiEligibility'];
  if (kind === 'nagashi_mangan') {
    const attestations = rawObj.nagashiEligibility;
    if (!Array.isArray(attestations) || attestations.length !== rawWinners.length) {
      throw new ResultValidationError('invalid_nagashi_eligibility', 'Each nagashi winner requires a complete discard history');
    }
    const attestedSeats = new Set<number>();
    nagashiEligibility = attestations.map((attestation) => {
      if (!attestation || typeof attestation !== 'object' || Array.isArray(attestation)) {
        throw new ResultValidationError('invalid_nagashi_eligibility', 'Invalid nagashi discard history');
      }
      const record = attestation as Record<string, unknown>;
      if (Object.keys(record).some((key) => key !== 'seatNo' && key !== 'discards') ||
          typeof record.seatNo !== 'number' || !Number.isInteger(record.seatNo) ||
          record.seatNo < 0 || record.seatNo >= playerCount ||
          attestedSeats.has(record.seatNo) || !Array.isArray(record.discards) || record.discards.length === 0) {
        throw new ResultValidationError('invalid_nagashi_eligibility', 'Invalid nagashi discard history');
      }
      attestedSeats.add(record.seatNo);
      const discards = record.discards.map((discard: unknown) => {
        if (!discard || typeof discard !== 'object' || Array.isArray(discard)) {
          throw new ResultValidationError('invalid_nagashi_eligibility', 'Invalid nagashi discard');
        }
        const tile = discard as Record<string, unknown>;
        if (Object.keys(tile).some((key) => key !== 'tile' && key !== 'called') ||
            typeof tile.tile !== 'string' || !/^(?:[1-9][mps]|[1-7]z)$/.test(tile.tile) ||
            tile.called !== false || !/^(?:[19][mps]|[1-7]z)$/.test(tile.tile)) {
          throw new ResultValidationError('invalid_nagashi_eligibility', 'Nagashi requires only uncalled terminal or honor discards');
        }
        return { tile: tile.tile, called: false };
      });
      return { seatNo: record.seatNo, discards };
    });
  } else if (rawObj.nagashiEligibility !== undefined) {
    throw new ResultValidationError('invalid_nagashi_eligibility', 'Nagashi eligibility is only allowed for nagashi_mangan');
  }

  const seenWinnerSeats: Record<number, true> = {};
  let sharedDealInSeatNo: number | null = null;
  const winners: WinnerInput[] = [];

  for (const item of rawWinners) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new ResultValidationError('invalid_winner', 'Each winner entry must be an object');
    }
    const w = item as Record<string, unknown>;
    if (
      typeof w.seatNo !== 'number' ||
      !Number.isInteger(w.seatNo) ||
      w.seatNo < 0 ||
      w.seatNo >= playerCount
    ) {
      throw new ResultValidationError('invalid_winner_seat', 'Winner seatNo is out of range');
    }
    if (seenWinnerSeats[w.seatNo]) {
      throw new ResultValidationError('duplicate_winner_seat', 'Duplicate winner seatNo');
    }
    seenWinnerSeats[w.seatNo] = true;

    if (kind === 'nagashi_mangan' &&
        (Object.keys(w).some((key) => key !== 'seatNo' && key !== 'han' && key !== 'fu') ||
          (w.han !== undefined && w.han !== 5) || (w.fu !== undefined && w.fu !== 30) ||
          !nagashiEligibility?.some((entry) => entry.seatNo === w.seatNo))) {
      throw new ResultValidationError('invalid_nagashi_eligibility', 'Nagashi winner must have an attested history and only standard mangan han/fu');
    }

    let yakumanCount: number | undefined;
    if (w.yakumanCount !== undefined && w.yakumanCount !== null) {
      if (
        typeof w.yakumanCount !== 'number' ||
        !Number.isInteger(w.yakumanCount) ||
        w.yakumanCount < 0 ||
        w.yakumanCount > 10
      ) {
        throw new ResultValidationError('invalid_yakuman_count', 'Invalid yakumanCount');
      }
      yakumanCount = w.yakumanCount;
    }
    let doubleYakumanCount: number | undefined;
    if (w.doubleYakumanCount !== undefined && w.doubleYakumanCount !== null) {
      if (
        typeof w.doubleYakumanCount !== 'number' ||
        !Number.isInteger(w.doubleYakumanCount) ||
        w.doubleYakumanCount < 0 ||
        w.doubleYakumanCount > 10
      ) {
        throw new ResultValidationError('invalid_double_yakuman_count', 'Invalid doubleYakumanCount');
      }
      if (w.doubleYakumanCount > 0 && !config.doubleYakuman) {
        throw new ResultValidationError('double_yakuman_disabled', 'Special double yakuman is disabled by this ruleset');
      }
      doubleYakumanCount = w.doubleYakumanCount;
    }

    let han = 5;
    let fu = 30;
    if (kind === 'ron' || kind === 'tsumo') {
      if (typeof w.han !== 'number' || !Number.isInteger(w.han) || w.han < 1 || w.han > 130) {
        throw new ResultValidationError('invalid_han', 'Winner han must be an integer between 1 and 130');
      }
      han = w.han;

      if ((w.fu === undefined || w.fu === null) && ((yakumanCount ?? 0) > 0 || (doubleYakumanCount ?? 0) > 0)) {
        fu = 30;
      } else if (
        typeof w.fu !== 'number' ||
        !Number.isInteger(w.fu) ||
        w.fu < 20 ||
        w.fu > 140
      ) {
        throw new ResultValidationError('invalid_fu', 'Winner fu must be an integer between 20 and 140');
      } else {
        fu = w.fu;
      }
    }

    let dealInSeatNo: number | null | undefined;
    if (w.dealInSeatNo !== undefined && w.dealInSeatNo !== null) {
      if (
        typeof w.dealInSeatNo !== 'number' ||
        !Number.isInteger(w.dealInSeatNo) ||
        w.dealInSeatNo < 0 ||
        w.dealInSeatNo >= playerCount
      ) {
        throw new ResultValidationError('invalid_deal_in_seat', 'Invalid dealInSeatNo');
      }
      dealInSeatNo = w.dealInSeatNo;
    } else if (topDealIn !== null && kind === 'ron') {
      dealInSeatNo = topDealIn;
    }

    if (kind === 'ron') {
      if (dealInSeatNo === undefined || dealInSeatNo === null) {
        throw new ResultValidationError('missing_deal_in_seat', 'Ron winner must specify dealInSeatNo');
      }
      if (dealInSeatNo === w.seatNo) {
        throw new ResultValidationError('invalid_deal_in_seat', 'Winner cannot deal in to themselves');
      }
      if (sharedDealInSeatNo === null) {
        sharedDealInSeatNo = dealInSeatNo;
      } else if (sharedDealInSeatNo !== dealInSeatNo) {
        throw new ResultValidationError('invalid_deal_in_seat', 'All winners in a multi-ron must share dealInSeatNo');
      }
    } else if (dealInSeatNo !== undefined && dealInSeatNo !== null) {
      throw new ResultValidationError('invalid_deal_in_seat', 'dealInSeatNo is only allowed on ron');
    }

    if (w.isRiichiDeclarationDealIn !== undefined && typeof w.isRiichiDeclarationDealIn !== 'boolean') {
      throw new ResultValidationError(
        'invalid_riichi_declaration_deal_in',
        'isRiichiDeclarationDealIn must be a boolean',
      );
    }
    const isRiichiDeclarationDealIn =
      typeof w.isRiichiDeclarationDealIn === 'boolean'
        ? w.isRiichiDeclarationDealIn
        : topRiichiDealIn;

    winners.push({
      seatNo: w.seatNo,
      han,
      fu,
      ...(yakumanCount !== undefined ? { yakumanCount } : {}),
      ...(doubleYakumanCount !== undefined ? { doubleYakumanCount } : {}),
      ...(dealInSeatNo !== undefined ? { dealInSeatNo } : {}),
      ...(isRiichiDeclarationDealIn !== undefined ? { isRiichiDeclarationDealIn } : {}),
    });
  }

  // F9(c): Validate riichiDeclarationDealInSeatNo & isRiichiDeclarationDealIn context
  let riichiDeclarationDealInSeatNo: number | null = null;
  if (rawObj.riichiDeclarationDealInSeatNo !== undefined && rawObj.riichiDeclarationDealInSeatNo !== null) {
    if (
      typeof rawObj.riichiDeclarationDealInSeatNo !== 'number' ||
      !Number.isInteger(rawObj.riichiDeclarationDealInSeatNo) ||
      rawObj.riichiDeclarationDealInSeatNo < 0 ||
      rawObj.riichiDeclarationDealInSeatNo >= playerCount
    ) {
      throw new ResultValidationError(
        'invalid_riichi_declaration_deal_in',
        'riichiDeclarationDealInSeatNo must be a valid seat number',
      );
    }
    riichiDeclarationDealInSeatNo = rawObj.riichiDeclarationDealInSeatNo;
  }

  const anyWinnerFlaggedRiichiDealIn = winners.some((w) => w.isRiichiDeclarationDealIn === true);
  const hasRiichiDeclarationCancel =
    riichiDeclarationDealInSeatNo !== null ||
    topRiichiDealIn === true ||
    anyWinnerFlaggedRiichiDealIn;
  if (
    hasRiichiDeclarationCancel &&
    (topRiichiDealIn === false || winners.some((w) => w.isRiichiDeclarationDealIn === false))
  ) {
    throw new ResultValidationError(
      'invalid_riichi_declaration_deal_in',
      'Conflicting riichi declaration deal-in flags for the same ron discard',
    );
  }

  if (hasRiichiDeclarationCancel) {
    if (kind !== 'ron' || sharedDealInSeatNo === null) {
      throw new ResultValidationError(
        'invalid_riichi_declaration_deal_in',
        'riichiDeclarationDealInSeatNo requires a marked ron deal-in seat',
      );
    }
    if (riichiDeclarationDealInSeatNo !== null && riichiDeclarationDealInSeatNo !== sharedDealInSeatNo) {
      throw new ResultValidationError(
        'invalid_riichi_declaration_deal_in',
        'riichiDeclarationDealInSeatNo must match the ron dealInSeatNo',
      );
    }
    const dealInSeatState = handState.seats.find((s) => s.seatNo === sharedDealInSeatNo);
    if (!dealInSeatState?.isRiichi) {
      throw new ResultValidationError(
        'invalid_riichi_declaration_deal_in',
        'Deal-in seat does not have an active riichi mark to cancel',
      );
    }
  }

  let tenpai: boolean[] | null = null;
  if (rawObj.tenpai !== undefined && rawObj.tenpai !== null) {
    if (
      !Array.isArray(rawObj.tenpai) ||
      rawObj.tenpai.length !== playerCount ||
      !rawObj.tenpai.every((v) => typeof v === 'boolean')
    ) {
      throw new ResultValidationError('invalid_tenpai', `tenpai must be an array of ${playerCount} booleans`);
    }
    tenpai = rawObj.tenpai as boolean[];
  }

  let chomboRole: Record<number, 'offender' | 'victim'> | null = null;
  if (rawObj.chomboRole !== undefined && rawObj.chomboRole !== null) {
    if (typeof rawObj.chomboRole !== 'object' || Array.isArray(rawObj.chomboRole)) {
      throw new ResultValidationError('invalid_chombo_role', 'chomboRole must be an object');
    }
    chomboRole = {};
    for (const [k, v] of Object.entries(rawObj.chomboRole as Record<string, unknown>)) {
      const seat = Number(k);
      if (!Number.isInteger(seat) || seat < 0 || seat >= playerCount || (v !== 'offender' && v !== 'victim')) {
        throw new ResultValidationError('invalid_chombo_role', 'Invalid chomboRole entry');
      }
      chomboRole[seat] = v;
    }
  }

  let manualPayments: Record<number, number> | null = null;
  if (rawObj.manualPayments !== undefined && rawObj.manualPayments !== null) {
    if (typeof rawObj.manualPayments !== 'object' || Array.isArray(rawObj.manualPayments)) {
      throw new ResultValidationError('invalid_manual_payments', 'manualPayments must be an object');
    }
    manualPayments = {};
    for (const [k, v] of Object.entries(rawObj.manualPayments as Record<string, unknown>)) {
      const seat = Number(k);
      if (!Number.isInteger(seat) || seat < 0 || seat >= playerCount ||
          typeof v !== 'number' || !Number.isSafeInteger(v) || Math.abs(v) > 2_147_483_647) {
        throw new ResultValidationError('invalid_manual_payments', 'Invalid manualPayments entry');
      }
      manualPayments[seat] = v;
    }
  }

  return {
    kind,
    winners,
    tenpai,
    chomboRole,
    riichiDeclarationDealInSeatNo,
    ...(nagashiEligibility !== undefined ? { nagashiEligibility } : {}),
    manualPayments,
  };
}

interface ProvisionalRanking {
  rank: number;
  seatNo: number;
  principalId: string | null;
  rawPoints: number;
  points: number;
  finalPoints: number;
}

// Runs with the match row locked; the caller commits and publishes after this returns.
async function finishMatchTransaction(
  client: PoolClient,
  matchId: string,
  actorPrincipalId: string,
  matchVersion: number,
  rules: EngineRulesConfig,
): Promise<{ provisionalRankings: ProvisionalRanking[] }> {

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

      // Rank by raw points to identify the recipient only when the rules award the pool.
      const sortedByRaw = [...seatAccounts].sort((a, b) => {
        if (b.rawPoints !== a.rawPoints) return b.rawPoints - a.rawPoints;
        return a.seatNo - b.seatNo;
      });

      const allocatesPool = rules.terminalRiichiPoolPolicy === 'first';
      const topSeatNo = allocatesPool ? sortedByRaw[0].seatNo : null;
      const topSeatAccountId = allocatesPool ? sortedByRaw[0].accountId : null;

      // The unallocated policy leaves the deposits in the pool account and excludes them from rankings.
      const withFinalPoints = seatAccounts.map((s) => ({
        ...s,
        finalPoints: s.rawPoints + (s.seatNo === topSeatNo ? residualPool : 0),
      }));
      const finalSorted = [...withFinalPoints].sort((a, b) => {
        if (b.finalPoints !== a.finalPoints) return b.finalPoints - a.finalPoints;
        return a.seatNo - b.seatNo;
      });

      let sharedRank = 1;
      const provisionalRankings = finalSorted.map((s, idx) => {
        if (idx > 0 && s.finalPoints !== finalSorted[idx - 1].finalPoints) sharedRank = idx + 1;
        return {
          rank: rules.tiedUmaPolicy === 'split' ? sharedRank : idx + 1,
          seatNo: s.seatNo,
          principalId: s.principalId,
          rawPoints: s.rawPoints,
          points: s.finalPoints,
          finalPoints: s.finalPoints,
        };
      });

      const newSeq = matchVersion + 1;
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
          actorPrincipalId,
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

      // Under the first-place policy, transfer the residual pool to the leader.
      if (residualPool > 0 && riichiPoolAccount && topSeatAccountId !== null) {
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
      return { provisionalRankings };
}

export function registerHandsRoutes(app: FastifyInstance): void {
  // POST /api/matches/:id/hands {} -> { hand: { id, roundWind, roundNumber, dealerSeatNo, honba, riichiPool, markRevision, resultRevision } }
  app.post<{ Params: { id: string } }>('/api/matches/:id/hands', async (req, reply) => {
    const principal = await requirePrincipal(req, reply);
    if (!principal) return;

    const matchId = req.params.id;
    const writeAccess = await checkConfirmedParticipantWriteAccess(matchId, principal.id);
    if (writeAccess === 'not_found') {
      return reply.code(404).send({ error: 'match_not_found', message: 'Match not found' });
    }
    if (writeAccess === 'forbidden') {
      return reply.code(403).send({ error: 'forbidden', message: 'Only checked-in participants can open hands' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const pRes = await client.query<{ status: string }>(
        `SELECT status FROM app.principals WHERE id = $1 FOR SHARE`,
        [principal.id],
      );
      if (pRes.rows[0]?.status !== 'active') {
        await client.query('ROLLBACK');
        return reply.code(403).send({ error: 'principal_inactive', message: 'Principal is not active' });
      }

      const mRes = await client.query<{
        id: string;
        state: string;
        version: string;
        current_hand_id: string | null;
        player_count: number;
        rules_snapshot: Record<string, unknown>;
      }>(`SELECT id, state, version, current_hand_id, player_count, rules_snapshot FROM app.matches WHERE id = $1 FOR UPDATE`, [matchId]);
      const match = mRes.rows[0];
      if (!match) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: 'match_not_found', message: 'Match not found' });
      }

      const txWriteAccess = await checkConfirmedParticipantWriteAccess(matchId, principal.id, client);
      if (txWriteAccess !== 'allowed') {
        await client.query('ROLLBACK');
        return reply.code(403).send({ error: 'forbidden', message: 'Only checked-in participants can open hands' });
      }

      if (match.state !== 'active') {
        await client.query('ROLLBACK');
        return reply.code(409).send({ error: 'match_not_active', message: 'Match must be in progress to open a hand' });
      }
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
        state: string;
        round_wind: string;
        round_number: number;
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
        `SELECT h.hand_no, h.state, h.round_wind, h.round_number, hr.calculation
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
      if (normalizeRulesConfig(prepareEngineRulesConfig(match.rules_snapshot), match.player_count)
        .fixedSouth4EndPolicy === 'completed_south_4' &&
          prev?.state === 'settled' && prev.round_wind === 'S' && prev.round_number === 4 &&
          prev.calculation?.nextHand?.roundWind === 'W' && prev.calculation.nextHand.roundNumber === 1) {
        await client.query('ROLLBACK');
        return reply.code(409).send({ error: 'final_round_complete', message: 'South 4 is complete; finish the match' });
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

  // POST /api/matches/:id/hands/:handId/marks { seatNo, riichi, expectedMarkRevision? } -> { markRevision }
  app.post<{
    Params: { id: string; handId: string };
    Body: { seatNo: number; riichi: boolean; expectedMarkRevision?: number | string };
  }>('/api/matches/:id/hands/:handId/marks', async (req, reply) => {
    const principal = await requirePrincipal(req, reply);
    if (!principal) return;

    const { id: matchId, handId } = req.params;
    const { seatNo, riichi, expectedMarkRevision } = req.body ?? {};

    const writeAccess = await checkConfirmedParticipantWriteAccess(matchId, principal.id);
    if (writeAccess === 'not_found') {
      return reply.code(404).send({ error: 'match_not_found', message: 'Match not found' });
    }
    if (writeAccess === 'forbidden') {
      return reply.code(403).send({ error: 'forbidden', message: 'Only checked-in participants can modify marks' });
    }

    if (typeof seatNo !== 'number' || !Number.isInteger(seatNo) || typeof riichi !== 'boolean') {
      return reply.code(400).send({ error: 'invalid_input', message: 'seatNo (int) and riichi (boolean) are required' });
    }
    if (expectedMarkRevision !== undefined && expectedMarkRevision !== null) {
      const parsedExp = Number(expectedMarkRevision);
      if (
        (typeof expectedMarkRevision !== 'number' && typeof expectedMarkRevision !== 'string') ||
        (typeof expectedMarkRevision === 'string' && !/^\d+$/.test(expectedMarkRevision)) ||
        !Number.isSafeInteger(parsedExp) ||
        parsedExp < 0
      ) {
        return reply.code(400).send({
          error: 'invalid_input',
          message: 'expectedMarkRevision must be a non-negative integer',
        });
      }
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const pRes = await client.query<{ status: string }>(
        `SELECT status FROM app.principals WHERE id = $1 FOR SHARE`,
        [principal.id],
      );
      if (pRes.rows[0]?.status !== 'active') {
        await client.query('ROLLBACK');
        return reply.code(403).send({ error: 'principal_inactive', message: 'Principal is not active' });
      }

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

      const txWriteAccess = await checkConfirmedParticipantWriteAccess(matchId, principal.id, client);
      if (txWriteAccess !== 'allowed') {
        await client.query('ROLLBACK');
        return reply.code(403).send({ error: 'forbidden', message: 'Only checked-in participants can modify marks' });
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

      // F6: Marks compare-and-swap on expectedMarkRevision when provided
      if (expectedMarkRevision !== undefined && expectedMarkRevision !== null) {
        if (Number(expectedMarkRevision) !== Number(hand.mark_revision)) {
          await client.query('ROLLBACK');
          return reply.code(409).send({
            error: 'stale_mark_revision',
            message: `expectedMarkRevision (${expectedMarkRevision}) does not match current markRevision (${hand.mark_revision})`,
            currentMarkRevision: Number(hand.mark_revision),
          });
        }
      }

      if (riichi) {
        const norm = normalizeRulesConfig(prepareEngineRulesConfig(match.rules_snapshot), match.player_count);
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

    const effectiveRulesConfig = prepareEngineRulesConfig(match.rules_snapshot);
    const norm = normalizeRulesConfig(effectiveRulesConfig, match.player_count);
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
      const normalizedInput = validateAndNormalizeResultInput(rawInput, match.player_count, handState, norm);
      const output = calculateSettlement(
        { rulesHash: match.rules_hash, config: effectiveRulesConfig },
        handState,
        normalizedInput,
        match.engine_version,
      );
      return {
        perSeat: output.perSeat,
        nextHand: output.nextHand,
      };
    } catch (err) {
      if (err instanceof ResultValidationError) {
        return reply.code(400).send({
          error: err.code,
          message: err.message,
        });
      }
      return reply.code(400).send({
        error: 'invalid_result_input',
        message: 'Invalid resultInput',
      });
    }
  });

  // POST /api/matches/:id/hands/:handId/results { resultInput, confirmedMarkRevision, clientEventId? } -> { perSeat, nextHand }
  app.post<{
    Params: { id: string; handId: string };
    Body: {
      resultInput?: Record<string, unknown>;
      confirmedMarkRevision?: number | string;
      clientEventId?: string;
    };
  }>('/api/matches/:id/hands/:handId/results', async (req, reply) => {
    const principal = await requirePrincipal(req, reply);
    if (!principal) return;

    const { id: matchId, handId } = req.params;
    const writeAccess = await checkConfirmedParticipantWriteAccess(matchId, principal.id);
    if (writeAccess === 'not_found') {
      return reply.code(404).send({ error: 'match_not_found', message: 'Match not found' });
    }
    if (writeAccess === 'forbidden') {
      return reply.code(403).send({ error: 'forbidden', message: 'Only checked-in participants can submit hand results' });
    }

    const rawInput = req.body?.resultInput;
    const confirmedMarkRevision = req.body?.confirmedMarkRevision;
    const rawClientEventId = req.body?.clientEventId;
    if (!rawInput || typeof rawInput !== 'object' || Array.isArray(rawInput)) {
      return reply.code(400).send({ error: 'missing_result_input', message: 'resultInput is required' });
    }
    if (confirmedMarkRevision === undefined || confirmedMarkRevision === null) {
      return reply.code(400).send({ error: 'missing_mark_revision', message: 'confirmedMarkRevision is required' });
    }
    if (
      (typeof confirmedMarkRevision !== 'number' && typeof confirmedMarkRevision !== 'string') ||
      (typeof confirmedMarkRevision === 'string' && !/^\d+$/.test(confirmedMarkRevision)) ||
      !Number.isSafeInteger(Number(confirmedMarkRevision)) ||
      Number(confirmedMarkRevision) < 0
    ) {
      return reply.code(400).send({
        error: 'invalid_mark_revision',
        message: 'confirmedMarkRevision must be a non-negative integer',
      });
    }

    let resolvedClientEventUuid: string | null = null;
    if (rawClientEventId !== undefined && rawClientEventId !== null) {
      if (typeof rawClientEventId !== 'string' || rawClientEventId.trim().length === 0) {
        return reply.code(400).send({
          error: 'invalid_client_event_id',
          message: 'clientEventId must be a non-empty string',
        });
      }
      resolvedClientEventUuid = resolveClientEventUuid(rawClientEventId);
    }
    const requestHash = createHash('sha256')
      .update(JSON.stringify({ matchId, handId, resultInput: rawInput, confirmedMarkRevision: Number(confirmedMarkRevision) }))
      .digest('hex');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Lock principal FOR SHARE and verify active status
      const pRes = await client.query<{ status: string }>(
        `SELECT status FROM app.principals WHERE id = $1 FOR SHARE`,
        [principal.id],
      );
      if (pRes.rows[0]?.status !== 'active') {
        await client.query('ROLLBACK');
        return reply.code(403).send({ error: 'principal_inactive', message: 'Principal is not active' });
      }

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

      const txWriteAccess = await checkConfirmedParticipantWriteAccess(matchId, principal.id, client);
      if (txWriteAccess !== 'allowed') {
        await client.query('ROLLBACK');
        return reply.code(403).send({ error: 'forbidden', message: 'Only checked-in participants can submit hand results' });
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

      // Retry identity is scoped to the original actor and request content.
      if (resolvedClientEventUuid !== null) {
        const existingEvRes = await client.query<{
          hand_id: string | null;
          type: string;
          request_hash: string;
          payload: { perSeat?: unknown; nextHand?: unknown };
        }>(
          `SELECT hand_id, type, request_hash, payload
           FROM app.match_events
           WHERE match_id = $1 AND actor_principal_id = $2 AND client_event_id = $3
           LIMIT 1`,
          [matchId, principal.id, resolvedClientEventUuid],
        );
        const existingEv = existingEvRes.rows[0];
        if (existingEv) {
          if (
            existingEv.hand_id === handId &&
            existingEv.type === 'hand_settled' &&
            existingEv.request_hash === requestHash
          ) {
            await client.query('COMMIT');
            return reply.code(200).send({
              perSeat: existingEv.payload.perSeat,
              nextHand: existingEv.payload.nextHand,
            });
          }
          await client.query('ROLLBACK');
          return reply.code(409).send({
            error: 'client_event_id_conflict',
            message: 'clientEventId has already been used for a different request',
          });
        }
      }

      if (match.state !== 'active') {
        await client.query('ROLLBACK');
        return reply.code(409).send({ error: 'match_not_active', message: 'Match is not active' });
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

      const effectiveRulesConfig = prepareEngineRulesConfig(match.rules_snapshot);
      const norm = normalizeRulesConfig(effectiveRulesConfig, match.player_count);
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
        normalizedInput = validateAndNormalizeResultInput(rawInput, match.player_count, handState, norm);
        output = calculateSettlement(
          { rulesHash: match.rules_hash, config: effectiveRulesConfig },
          handState,
          normalizedInput,
          match.engine_version,
        );
      } catch (err) {
        await client.query('ROLLBACK');
        if (err instanceof ResultValidationError) {
          return reply.code(400).send({
            error: err.code,
            message: err.message,
          });
        }
        return reply.code(400).send({
          error: 'invalid_result_input',
          message: 'Invalid resultInput',
        });
      }

      // F8: Derive engine-effective winners and kind from output.perSeat
      const effectiveWinnerSeatNos: Record<number, true> = {};
      for (const sp of output.perSeat) {
        if (sp.breakdown.some((b) => EFFECTIVE_WIN_REASONS[b.reason])) {
          effectiveWinnerSeatNos[sp.seatNo] = true;
        }
      }
      const effectiveWinners = normalizedInput.winners.filter((w) => effectiveWinnerSeatNos[w.seatNo]);
      const effectiveKind: ResultInput['kind'] =
        normalizedInput.kind === 'ron' && effectiveWinners.length === 0
          ? 'ryuukyoku'
          : normalizedInput.kind;
      const effectiveInput: ResultInput = {
        ...normalizedInput,
        kind: effectiveKind,
        winners: effectiveWinners,
      };

      const newResultRevision = Number(hand.result_revision) + 1;
      const inputMode = effectiveInput.manualPayments ? 'manual_adjustment' : 'han_fu';

      // Insert hand_results with engine-effective kind and winners
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
          effectiveKind,
          Number(hand.mark_revision),
          inputMode,
          JSON.stringify(effectiveInput),
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
          effectiveKind === 'ryuukyoku' && Array.isArray(effectiveInput.tenpai)
            ? Boolean(effectiveInput.tenpai[i])
            : null;
        const isNagashi =
          effectiveKind === 'nagashi_mangan' &&
          effectiveWinners.some((w) => w.seatNo === sp.seatNo);
        const chomboRole = effectiveInput.chomboRole?.[sp.seatNo] ?? null;

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

      // Insert result_winners using ONLY engine-effective winners
      if (
        (effectiveKind === 'ron' ||
          effectiveKind === 'tsumo' ||
          effectiveKind === 'nagashi_mangan') &&
        effectiveWinners.length > 0
      ) {
        for (const w of effectiveWinners) {
          const fuVal =
            typeof w.fu === 'number' && w.fu >= 20 && w.fu <= 140 ? w.fu : null;
          const dealIn =
            effectiveKind === 'ron' && typeof w.dealInSeatNo === 'number'
              ? w.dealInSeatNo
              : null;
          await client.query(
            `INSERT INTO app.result_winners (
               result_id, seat_no, han, fu, yakuman_count, deal_in_seat_no
             )
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [resultId, w.seatNo, w.han ?? 0, fuVal, (w.yakumanCount ?? 0) + 2 * (w.doubleYakumanCount ?? 0), dealIn],
          );
        }
      }

      // Insert match_events with caller-supplied clientEventId (or fresh UUID)
      const newSeq = Number(match.version) + 1;
      const eventClientUuid = resolvedClientEventUuid ?? randomUUID();
      const reqHash = requestHash;

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
          eventClientUuid,
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
      let automaticRankings: ProvisionalRanking[] | null = null;
      if (norm.automaticEndPolicy === 'ranked_sanma' &&
          isAutomaticMatchEnd(
            effectiveRulesConfig,
            handState,
            effectiveInput,
            output.nextHand,
            snapshotState.seats,
          )) {
        const finished = await finishMatchTransaction(client, matchId, principal.id, newSeq, norm);
        automaticRankings = finished.provisionalRankings;
      }


      await client.query('COMMIT');

      broadcastMatchEvent(matchId, 'hand_settled', {
        matchId,
        handId,
        perSeat: output.perSeat,
        nextHand: output.nextHand,
      });
      if (automaticRankings) {
        broadcastMatchEvent(matchId, 'match_finished', {
          matchId,
          finished: true,
          provisionalRankings: automaticRankings,
        });
      }


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

      const pRes = await client.query<{ status: string }>(
        `SELECT status FROM app.principals WHERE id = $1 FOR SHARE`,
        [principal.id],
      );
      if (pRes.rows[0]?.status !== 'active') {
        await client.query('ROLLBACK');
        return reply.code(403).send({ error: 'principal_inactive', message: 'Principal is not active' });
      }

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
      const ownerMemRes = await client.query<{ status: string }>(
        `SELECT status FROM app.match_members WHERE match_id = $1 AND principal_id = $2`,
        [matchId, principal.id],
      );
      if (ownerMemRes.rows[0]?.status !== 'active') {
        await client.query('ROLLBACK');
        return reply.code(403).send({ error: 'forbidden', message: 'Owner membership is not active' });
      }
      if (match.state !== 'active') {
        await client.query('ROLLBACK');
        return reply.code(409).send({ error: 'match_not_active', message: 'Match is not active' });
      }
      const rules = normalizeRulesConfig(prepareEngineRulesConfig(match.rules_snapshot), match.player_count);
      if (rules.fixedSouth4EndPolicy === 'completed_south_4') {
        const completion = await client.query<{ complete: boolean | null }>(SOUTH4_COMPLETION_SQL, [matchId]);
        if (completion.rows[0]?.complete !== true) {
          await client.query('ROLLBACK');
          return reply.code(409).send({
            error: 'final_round_incomplete',
            message: 'Finish requires a settled South 4 hand with the final dealer rotation complete',
          });
        }
      }
      if (rules.automaticEndPolicy === 'ranked_sanma') {
        await client.query('ROLLBACK');
        return reply.code(409).send({
          error: 'automatic_end_required',
          message: 'This ruleset finishes automatically at its last-dealer or round-cap condition',
        });
      }
      // Void any unsettled open hand
      await client.query(
        `UPDATE app.hands SET state = 'voided' WHERE match_id = $1 AND state = 'open'`,
        [matchId],
      );

      const { provisionalRankings } = await finishMatchTransaction(
        client, matchId, principal.id, Number(match.version), rules,
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

    const fixedSouth4 = normalizeRulesConfig(prepareEngineRulesConfig(match.rules_snapshot), match.player_count)
      .fixedSouth4EndPolicy === 'completed_south_4';
    const completedSouth4 = fixedSouth4
      ? (await pool.query<{ complete: boolean | null }>(SOUTH4_COMPLETION_SQL, [matchId])).rows[0]?.complete === true
      : false;

    const terminal = calculateTerminalSettlement(
      seatEntries,
      { rulesHash: match.rules_hash, config: match.rules_snapshot },
      { riichiPool: poolBalance, requireTargetPoints: false, completedSouth4 },
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

      const pRes = await client.query<{ status: string }>(
        `SELECT status FROM app.principals WHERE id = $1 FOR SHARE`,
        [principal.id],
      );
      if (pRes.rows[0]?.status !== 'active') {
        await client.query('ROLLBACK');
        return reply.code(403).send({ error: 'principal_inactive', message: 'Principal is not active' });
      }

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
      const ownerMemChk = await client.query<{ status: string }>(
        `SELECT status FROM app.match_members WHERE match_id = $1 AND principal_id = $2`,
        [matchId, principal.id],
      );
      if (ownerMemChk.rows[0]?.status !== 'active') {
        await client.query('ROLLBACK');
        return reply.code(403).send({ error: 'forbidden', message: 'Owner membership is not active' });
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
      const fixedSouth4 = normalizeRulesConfig(prepareEngineRulesConfig(match.rules_snapshot), match.player_count)
        .fixedSouth4EndPolicy === 'completed_south_4';
      const completedSouth4 = fixedSouth4
        ? (await client.query<{ complete: boolean | null }>(SOUTH4_COMPLETION_SQL, [matchId])).rows[0]?.complete === true
        : false;


      const terminal = calculateTerminalSettlement(
        seatEntries.map((s) => ({ seatNo: s.seatNo, points: s.points })),
        { rulesHash: match.rules_hash, config: match.rules_snapshot },
        // The owner has already finished this match explicitly; settle even if
        // its ruleset would otherwise require a target score to auto-finish.
        { riichiPool: poolBalance, requireTargetPoints: false, completedSouth4 },
      );
      if (!terminal.isGameEnd) {
        await client.query('ROLLBACK');
        return reply.code(409).send({ error: 'match_not_finished' });
      }

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
