// Shared new-model match view (Round 1 final-native).
// Used by finalModel.ts handlers and by the legacy GET /api/matches/:id
// detail route, so new-model matches always serialize the same way.
import { pool } from '../db.js';

const NEW_STATUS: Record<string, string> = {
  preparing: 'waiting',
  active: 'in_progress',
  finished: 'finished',
  abandoned: 'cancelled',
};

export interface MatchRow {
  id: string;
  owner_principal_id: string;
  player_count: number;
  join_code: string | null;
  state: string;
  final_scores: { wind: string; score: number; rank: number }[] | null;
  created_at: Date;
  started_at: Date | null;
  ended_at: Date | null;
  corrected_at: Date | null;
}

type Db = { query: typeof pool.query };

export async function serializeMatch(matchId: string, db: Db = pool): Promise<Record<string, unknown> | null> {
  const mRes = await db.query<MatchRow>(
    `SELECT id, owner_principal_id, player_count, join_code, state, final_scores,
            created_at, started_at, ended_at, corrected_at
     FROM app.matches WHERE id = $1 AND deleted_at IS NULL`,
    [matchId],
  );
  const m = mRes.rows[0];
  if (!m) return null;
  const membersRes = await db.query<{ principal_id: string; display_name: string }>(
    `SELECT mm.principal_id, p.display_name
     FROM app.match_members mm
     JOIN app.principals p ON p.id = mm.principal_id
     WHERE mm.match_id = $1 AND mm.status = 'active' AND mm.role = 'participant'
     ORDER BY mm.joined_at, mm.id`,
    [matchId],
  );
  const seatsRes = await db.query<{ principal_id: string; drawn_wind: string | null; seat_no: number }>(
    `SELECT mm.principal_id, mm.drawn_wind, sa.seat_no
     FROM app.seat_assignments sa
     JOIN app.match_members mm ON mm.id = sa.member_id
     WHERE sa.match_id = $1 AND sa.end_hand_no IS NULL
     ORDER BY sa.seat_no`,
    [matchId],
  );
  return {
    id: m.id,
    mode: m.player_count === 3 ? '3p' : '4p',
    status: NEW_STATUS[m.state] ?? m.state,
    hostId: m.owner_principal_id,
    joinCode: m.join_code,
    members: membersRes.rows.map((r) => ({
      userId: r.principal_id,
      displayName: r.display_name,
      isHost: r.principal_id === m.owner_principal_id,
    })),
    seats: seatsRes.rows.map((r) => ({
      seatNo: r.seat_no,
      userId: r.principal_id,
      wind: r.drawn_wind,
    })),
    finalScores: m.final_scores,
    createdAt: m.created_at.toISOString(),
    startedAt: m.started_at?.toISOString() ?? null,
    finishedAt: m.ended_at?.toISOString() ?? null,
    correctedAt: m.corrected_at?.toISOString() ?? null,
  };
}
