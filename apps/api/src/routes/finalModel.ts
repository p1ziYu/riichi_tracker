// Final-native Round 1 model (spec section 2).
//
// Status vocabulary is new, storage is old: matches.state keeps
// preparing/active/finished/abandoned, mapped here to
// waiting/in_progress/finished/cancelled. Seats live in
// match_members.drawn_wind + seat_assignments, written exactly once by the
// atomic auto-draw inside POST /api/matches/:id/join when the room fills.
// Only final scores are ever recorded (migration 015 adds
// matches.final_scores / matches.corrected_at); there is no per-hand data
// in this model, and the retired per-hand / draw / template routes return
// 410 elsewhere (matches.ts, rulesets.ts, and the stubs at the bottom here).
//
// Join credentials: a 6-digit room code, or a signed deep-link token issued
// by POST /api/matches (24h share token) or GET /api/matches/by-code/:code
// (10min token). Tokens are verified but NOT consumed on join, so one
// shared link/QR can admit every seat; a token is useless once the room
// has started anyway, because join then requires waiting state.
import { createHash, randomInt } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { isAdminPrincipal, requirePrincipal } from '../auth.js';
import { pool } from '../db.js';
import { serializeMatch } from './matchView.js';
import type { MatchRow } from './matchView.js';
import { normalizeJoinCode } from '../joinCode.js';
import { verifyCheckInTokenSignature } from './matches.js';
import { broadcastMatchEvent } from '../ws.js';

const WINDS_4 = ['E', 'S', 'W', 'N'];
const WINDS_3 = ['E', 'S', 'W'];
const WIND_ORDER: Record<string, number> = { E: 0, S: 1, W: 2, N: 3 };


interface FinalScoreEntry {
  wind: string;
  score: number;
  rank: number;
}




function validateFinalScores(
  playerCount: number,
  seatWinds: string[],
  input: unknown,
): { stored: FinalScoreEntry[] } | { error: string; message: string } {
  const winds = playerCount === 3 ? WINDS_3 : WINDS_4;
  const total = playerCount === 3 ? 1050 : 1000;
  if (!Array.isArray(input) || input.length !== playerCount) {
    return { error: 'seats_incomplete', message: `Expected ${playerCount} scores, one per seat.` };
  }
  const seen = new Set<string>();
  const entries: { wind: string; score: number }[] = [];
  for (const entry of input as Record<string, unknown>[]) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return { error: 'invalid_scores', message: 'Each score must be { wind, score }.' };
    }
    const wind = entry.wind;
    if (typeof wind !== 'string' || !winds.includes(wind)) {
      return { error: 'unknown_wind', message: `Unknown wind: ${String(wind)}.` };
    }
    if (seen.has(wind)) {
      return { error: 'duplicate_wind', message: `Duplicate score for wind ${wind}.` };
    }
    seen.add(wind);
    const score = entry.score;
    if (typeof score !== 'number' || !Number.isInteger(score)) {
      return { error: 'score_not_integer', message: `Score for wind ${wind} must be an integer.` };
    }
    if (score < -9999 || score > 9999) {
      return { error: 'score_out_of_range', message: `Score for wind ${wind} must be between -9999 and 9999.` };
    }
    entries.push({ wind, score });
  }
  // Seats are locked: the submitted winds must be exactly the drawn seats.
  if (seatWinds.length !== playerCount || !winds.every((w) => seen.has(w) && seatWinds.includes(w))) {
    return { error: 'seats_incomplete', message: 'Scores must cover exactly the drawn seats.' };
  }
  const sum = entries.reduce((acc, e) => acc + e.score, 0);
  if (sum !== total) {
    return { error: 'total_mismatch', message: `Scores must sum to ${total}, got ${sum}.` };
  }
  // Rank: higher score first; ties broken by wind order E > S > W > N.
  const ranked = [...entries].sort(
    (a, b) => b.score - a.score || WIND_ORDER[a.wind] - WIND_ORDER[b.wind],
  );
  const rankByWind = new Map(ranked.map((e, i) => [e.wind, i + 1]));
  const stored = [...entries]
    .sort((a, b) => WIND_ORDER[a.wind] - WIND_ORDER[b.wind])
    .map((e) => ({ wind: e.wind, score: e.score, rank: rankByWind.get(e.wind) as number }));
  return { stored };
}

async function requireAdmin(req: Parameters<typeof requirePrincipal>[0], reply: Parameters<typeof requirePrincipal>[1]) {
  const principal = await requirePrincipal(req, reply);
  if (!principal) return null;
  if (!(await isAdminPrincipal(principal))) {
    await reply.code(403).send({ error: 'forbidden', message: 'Admin access required' });
    return null;
  }
  return principal;
}

export function registerFinalModelRoutes(app: FastifyInstance): void {
  // POST /api/matches/:id/join { code?, token? } -> match view.
  app.post<{ Params: { id: string }; Body: { code?: string; token?: string } }>(
    '/api/matches/:id/join',
    async (req, reply) => {
      const principal = await requirePrincipal(req, reply);
      if (!principal) return;
      if (principal.kind !== 'user') {
        return reply.code(403).send({ error: 'account_required', message: '请登录账户后加入牌局' });
      }
      const matchId = req.params.id;
      const body = req.body ?? {};
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const mRes = await client.query<{
          id: string; owner_principal_id: string; player_count: number; state: string; join_code: string | null;
        }>(
          `SELECT id, owner_principal_id, player_count, state, join_code
           FROM app.matches WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
          [matchId],
        );
        const match = mRes.rows[0];
        if (!match) {
          await client.query('ROLLBACK');
          return reply.code(404).send({ error: 'match_not_found', message: 'Match not found' });
        }
        const memberRes = await client.query<{ id: string }>(
          `SELECT id FROM app.match_members
           WHERE match_id = $1 AND principal_id = $2 AND status = 'active' AND role = 'participant'`,
          [matchId, principal.id],
        );
        // Repeat join is idempotent, whatever the match state.
        if (memberRes.rows[0]) {
          await client.query('COMMIT');
          return serializeMatch(matchId);
        }
        if (match.state !== 'preparing') {
          await client.query('ROLLBACK');
          const code =
            match.state === 'finished' ? 'match_finished'
            : match.state === 'abandoned' ? 'match_cancelled'
            : 'match_already_started';
          return reply.code(409).send({ error: code, message: 'Match is not waiting for players' });
        }
        // Credential: room code or signed deep-link token (either, not both required).
        // Native share links/QR carry the room code in ?token=, so a token value
        // equal to the room code is accepted as the code before signature checks.
        if (typeof body.token === 'string' && body.token.length > 0) {
          const tokenAsCode = normalizeJoinCode(body.token);
          if (!(tokenAsCode && tokenAsCode === match.join_code)) {
            if (!verifyCheckInTokenSignature(body.token, matchId)) {
              await client.query('ROLLBACK');
              return reply.code(400).send({ error: 'invalid_token', message: 'Invalid or expired join token' });
            }
            const tokenHash = createHash('sha256').update(body.token).digest('hex');
            const inv = await client.query(
              `SELECT 1 FROM app.match_invitations
               WHERE match_id = $1 AND scope = 'join' AND hmac_key_id = $2
                 AND revoked_at IS NULL AND expires_at > now()`,
              [matchId, tokenHash],
            );
            if (!inv.rowCount) {
              await client.query('ROLLBACK');
              return reply.code(400).send({ error: 'token_consumed_or_expired', message: 'Join token already used or expired' });
            }
            // Deliberately not revoked: one shared link/QR admits every seat.
          }
        } else if (typeof body.code === 'string' && body.code.length > 0) {
          const code = normalizeJoinCode(body.code);
          if (!code || code !== match.join_code) {
            await client.query('ROLLBACK');
            return reply.code(400).send({ error: 'invalid_join_code', message: 'Join code does not match this match' });
          }
        } else {
          await client.query('ROLLBACK');
          return reply.code(400).send({ error: 'missing_credential', message: 'A room code or join token is required' });
        }
        const countRes = await client.query<{ count: number }>(
          `SELECT COUNT(*)::int AS count FROM app.match_members
           WHERE match_id = $1 AND status = 'active' AND role = 'participant'`,
          [matchId],
        );
        if (countRes.rows[0].count >= match.player_count) {
          await client.query('ROLLBACK');
          return reply.code(409).send({ error: 'match_full', message: 'Match is full' });
        }
        const memberId = (await client.query<{ id: string }>(
          `INSERT INTO app.match_members (match_id, principal_id, role, status)
           VALUES ($1, $2, 'participant', 'active')
           ON CONFLICT (match_id, principal_id)
           DO UPDATE SET role = 'participant', status = 'active', removed_at = NULL, hidden_at = NULL
           RETURNING id`,
          [matchId, principal.id],
        )).rows[0].id;
        void memberId;
        const membersRes = await client.query<{ id: string; principal_id: string; display_name: string }>(
          `SELECT mm.id, mm.principal_id, p.display_name
           FROM app.match_members mm
           JOIN app.principals p ON p.id = mm.principal_id
           WHERE mm.match_id = $1 AND mm.status = 'active' AND mm.role = 'participant'
           ORDER BY mm.joined_at, mm.id`,
          [matchId],
        );
        let drew = false;
        if (membersRes.rows.length === match.player_count) {
          // Atomic auto-draw: shuffle members, seat 0 is East (dealer).
          const shuffled = [...membersRes.rows];
          for (let i = shuffled.length - 1; i > 0; i--) {
            const j = randomInt(i + 1);
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
          }
          const winds = match.player_count === 3 ? WINDS_3 : WINDS_4;
          for (let seatNo = 0; seatNo < shuffled.length; seatNo++) {
            const member = shuffled[seatNo];
            await client.query('UPDATE app.match_members SET drawn_wind = $1 WHERE id = $2', [winds[seatNo], member.id]);
            await client.query(
              `INSERT INTO app.seat_assignments (match_id, seat_no, member_id, start_hand_no, confirmed_by)
               VALUES ($1, $2, $3, 0, $4)`,
              [matchId, seatNo, member.id, match.owner_principal_id],
            );
          }
          await client.query(
            `UPDATE app.matches SET state = 'active', started_at = now(), seating_drawn_at = now(), dealer_seat_no = 0 WHERE id = $1`,
            [matchId],
          );
          drew = true;
        }
        await client.query('COMMIT');
        broadcastMatchEvent(matchId, 'member_joined', { matchId, principalId: principal.id });
        if (drew) {
          broadcastMatchEvent(matchId, 'seats_drawn', { matchId });
        }
        return serializeMatch(matchId);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },
  );

  // GET /api/matches/mine -> only matches the caller participates in.
  app.get('/api/matches/mine', async (req, reply) => {
    const principal = await requirePrincipal(req, reply);
    if (!principal) return;
    const res = await pool.query<{ id: string }>(
      `SELECT m.id
       FROM app.matches m
       JOIN app.match_members mm ON mm.match_id = m.id AND mm.status = 'active'
       LEFT JOIN app.member_access_grants mag ON mag.member_id = mm.id AND mag.revoked_at IS NULL
       WHERE (mm.principal_id = $1 OR mag.principal_id = $1)
         AND m.deleted_at IS NULL
       GROUP BY m.id, m.state, m.created_at
       ORDER BY
         CASE m.state WHEN 'active' THEN 0 WHEN 'preparing' THEN 1 WHEN 'finished' THEN 2 ELSE 3 END,
         m.created_at DESC`,
      [principal.id],
    );
    const out = [];
    for (const row of res.rows) {
      const view = await serializeMatch(row.id);
      if (view) out.push(view);
    }
    return out;
  });

  // POST /api/matches/:id/final-scores (host only, in_progress) -> finished.
  app.post<{ Params: { id: string }; Body: { scores?: unknown } }>(
    '/api/matches/:id/final-scores',
    async (req, reply) => {
      const principal = await requirePrincipal(req, reply);
      if (!principal) return;
      const matchId = req.params.id;
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const mRes = await client.query<MatchRow>(
          `SELECT * FROM app.matches WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
          [matchId],
        );
        const match = mRes.rows[0];
        if (!match) {
          await client.query('ROLLBACK');
          return reply.code(404).send({ error: 'match_not_found', message: 'Match not found' });
        }
        if (match.owner_principal_id !== principal.id) {
          await client.query('ROLLBACK');
          return reply.code(403).send({ error: 'forbidden', message: 'Only the match host can record final scores' });
        }
        if (match.state !== 'active') {
          await client.query('ROLLBACK');
          return reply.code(409).send({ error: 'invalid_state', message: 'Match is not in progress' });
        }
        const seatRes = await client.query<{ drawn_wind: string | null }>(
          `SELECT drawn_wind FROM app.match_members
           WHERE match_id = $1 AND status = 'active' AND role = 'participant'`,
          [matchId],
        );
        const seatWinds = seatRes.rows.map((r) => r.drawn_wind).filter((w): w is string => w !== null);
        const validated = validateFinalScores(match.player_count, seatWinds, req.body?.scores);
        if ('error' in validated) {
          await client.query('ROLLBACK');
          return reply.code(400).send({ error: validated.error, message: validated.message });
        }
        await client.query(
          `UPDATE app.matches SET final_scores = $2::jsonb, state = 'finished', ended_at = now() WHERE id = $1`,
          [matchId, JSON.stringify(validated.stored)],
        );
        await client.query('COMMIT');
        broadcastMatchEvent(matchId, 'match_finished', { matchId });
        return serializeMatch(matchId);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },
  );

  // PATCH /api/matches/:id/final-scores (host only, finished; seats locked).
  app.patch<{ Params: { id: string }; Body: { scores?: unknown } }>(
    '/api/matches/:id/final-scores',
    async (req, reply) => {
      const principal = await requirePrincipal(req, reply);
      if (!principal) return;
      const matchId = req.params.id;
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const mRes = await client.query<MatchRow>(
          `SELECT * FROM app.matches WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
          [matchId],
        );
        const match = mRes.rows[0];
        if (!match) {
          await client.query('ROLLBACK');
          return reply.code(404).send({ error: 'match_not_found', message: 'Match not found' });
        }
        if (match.owner_principal_id !== principal.id) {
          await client.query('ROLLBACK');
          return reply.code(403).send({ error: 'forbidden', message: 'Only the match host can correct final scores' });
        }
        if (match.state !== 'finished') {
          await client.query('ROLLBACK');
          return reply.code(409).send({ error: 'invalid_state', message: 'Only a finished match can be corrected' });
        }
        const seatRes = await client.query<{ drawn_wind: string | null }>(
          `SELECT drawn_wind FROM app.match_members
           WHERE match_id = $1 AND status = 'active' AND role = 'participant'`,
          [matchId],
        );
        const seatWinds = seatRes.rows.map((r) => r.drawn_wind).filter((w): w is string => w !== null);
        const validated = validateFinalScores(match.player_count, seatWinds, req.body?.scores);
        if ('error' in validated) {
          await client.query('ROLLBACK');
          return reply.code(400).send({ error: validated.error, message: validated.message });
        }
        await client.query(
          `UPDATE app.matches SET final_scores = $2::jsonb, corrected_at = now() WHERE id = $1`,
          [matchId, JSON.stringify(validated.stored)],
        );
        await client.query('COMMIT');
        return serializeMatch(matchId);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },
  );

  // POST /api/matches/:id/cancel (host only, not finished) -> cancelled.
  app.post<{ Params: { id: string } }>('/api/matches/:id/cancel', async (req, reply) => {
    const principal = await requirePrincipal(req, reply);
    if (!principal) return;
    const matchId = req.params.id;
    const mRes = await pool.query<{ owner_principal_id: string; state: string }>(
      `SELECT owner_principal_id, state FROM app.matches WHERE id = $1 AND deleted_at IS NULL`,
      [matchId],
    );
    const match = mRes.rows[0];
    if (!match) {
      return reply.code(404).send({ error: 'match_not_found', message: 'Match not found' });
    }
    if (match.owner_principal_id !== principal.id) {
      return reply.code(403).send({ error: 'forbidden', message: 'Only the match host can cancel the match' });
    }
    if (match.state === 'finished') {
      return reply.code(409).send({ error: 'invalid_state', message: 'A finished match cannot be cancelled' });
    }
    if (match.state !== 'abandoned') {
      await pool.query(`UPDATE app.matches SET state = 'abandoned' WHERE id = $1`, [matchId]);
    }
    return serializeMatch(matchId);
  });

  // Admin endpoints (isAdmin only, else 403; unauthenticated still 401).
  app.get('/api/admin/players', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const res = await pool.query<{ id: string; display_name: string; match_count: string }>(
      `SELECT p.id, p.display_name, COUNT(DISTINCT mm.match_id)::text AS match_count
       FROM app.principals p
       LEFT JOIN app.match_members mm ON mm.principal_id = p.id
       WHERE p.kind = 'user' AND p.status <> 'erased'
       GROUP BY p.id, p.display_name
       ORDER BY COUNT(DISTINCT mm.match_id) DESC, p.display_name ASC`,
    );
    return {
      players: res.rows.map((r) => ({
        id: r.id,
        displayName: r.display_name,
        matchCount: Number(r.match_count),
      })),
    };
  });

  // DELETE /api/admin/players/:id -> SOFT delete an account (never the principal
  // row, never match_members / matches / final_scores). History stays intact and
  // the deleted member renders as '已注销玩家' via serializeMatch.
  app.delete<{ Params: { id: string } }>('/api/admin/players/:id', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    if (!admin) return;
    const targetId = req.params.id;
    if (targetId === admin.id) {
      return reply.code(403).send({ error: 'cannot_delete_self', message: 'Cannot delete your own account' });
    }
    const targetRes = await pool.query<{ id: string; auth_user_id: string | null }>(
      `SELECT id, auth_user_id FROM app.principals WHERE id = $1 AND kind = 'user' AND status = 'active'`,
      [targetId],
    );
    const target = targetRes.rows[0];
    if (!target) {
      return reply.code(404).send({ error: 'player_not_found', message: 'Player not found' });
    }
    const authUserId = target.auth_user_id;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE app.principals SET kind = 'erased', status = 'erased', auth_user_id = NULL, display_name = '已注销玩家' WHERE id = $1`,
        [targetId],
      );
      if (authUserId) {
        // Cascades sessions, credential accounts, and the auth-principal map,
        // so existing sessions die and sign-in with that email fails afterwards.
        await client.query(`DELETE FROM public."user" WHERE id = $1`, [authUserId]);
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    return { deleted: true };
  });

  app.get('/api/admin/matches', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const res = await pool.query<{ id: string }>(
      `SELECT id FROM app.matches WHERE deleted_at IS NULL ORDER BY created_at DESC`,
    );
    const out = [];
    for (const row of res.rows) {
      const view = await serializeMatch(row.id);
      if (view) out.push(view);
    }
    return out;
  });

  app.delete<{ Params: { id: string } }>('/api/admin/matches/:id', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const matchId = req.params.id;
    const res = await pool.query(
      `UPDATE app.matches SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL`,
      [matchId],
    );
    if ((res.rowCount ?? 0) === 0) {
      return reply.code(404).send({ error: 'match_not_found', message: 'Match not found' });
    }
    return { deleted: true };
  });

  app.patch<{ Params: { id: string }; Body: { scores?: unknown } }>(
    '/api/admin/matches/:id/final-scores',
    async (req, reply) => {
      if (!(await requireAdmin(req, reply))) return;
      const matchId = req.params.id;
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const mRes = await client.query<MatchRow>(
          `SELECT * FROM app.matches WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
          [matchId],
        );
        const match = mRes.rows[0];
        if (!match) {
          await client.query('ROLLBACK');
          return reply.code(404).send({ error: 'match_not_found', message: 'Match not found' });
        }
        if (match.state !== 'finished') {
          await client.query('ROLLBACK');
          return reply.code(409).send({ error: 'invalid_state', message: 'Only a finished match can be corrected' });
        }
        const seatRes = await client.query<{ drawn_wind: string | null }>(
          `SELECT drawn_wind FROM app.match_members
           WHERE match_id = $1 AND status = 'active' AND role = 'participant'`,
          [matchId],
        );
        const seatWinds = seatRes.rows.map((r) => r.drawn_wind).filter((w): w is string => w !== null);
        const validated = validateFinalScores(match.player_count, seatWinds, req.body?.scores);
        if ('error' in validated) {
          await client.query('ROLLBACK');
          return reply.code(400).send({ error: validated.error, message: validated.message });
        }
        await client.query(
          `UPDATE app.matches SET final_scores = $2::jsonb, corrected_at = now() WHERE id = $1`,
          [matchId, JSON.stringify(validated.stored)],
        );
        await client.query('COMMIT');
        return serializeMatch(matchId);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },
  );

  // Retired per-hand / settlement routes (410; hands.ts is no longer registered).
  const gone = (error: string, message: string) => async (
    req: Parameters<typeof requirePrincipal>[0],
    reply: Parameters<typeof requirePrincipal>[1],
  ) => {
    const principal = await requirePrincipal(req, reply);
    if (!principal) return;
    return reply.code(410).send({ error, message });
  };
  const roundsGone = gone('rounds_retired', 'Per-hand recording is retired; only final scores are recorded.');
  const settlementGone = gone('settlement_retired', 'Per-hand settlement is retired; only final scores are recorded.');
  app.post('/api/matches/:id/hands', roundsGone);
  app.post('/api/matches/:id/hands/:handId/marks', roundsGone);
  app.post('/api/matches/:id/hands/:handId/preview', roundsGone);
  app.post('/api/matches/:id/hands/:handId/results', roundsGone);
  app.get('/api/matches/:id/hands', roundsGone);
  app.post('/api/matches/:id/finish', roundsGone);
  app.get('/api/matches/:id/settlement/preview', settlementGone);
  app.post('/api/matches/:id/settlement/confirm', settlementGone);
}
