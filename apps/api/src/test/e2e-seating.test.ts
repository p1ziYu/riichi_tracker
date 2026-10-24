// First import must preflight DATABASE_URL before env.js, db.js, or index.js evaluates.
import { assertE2EDatabaseUrl } from './e2e-db-guard.js';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import '../env.js';
import { pool } from '../db.js';
import { buildApp } from '../index.js';

interface Player {
  cookie: string;
  principalId: string;
  displayName: string;
}
interface Seat {
  seatNo: number;
  principalId: string;
  displayName: string;
  wind: string;
}
interface MatchDetail {
  match: { id: string; status: string; seatingDrawnAt: string | null; dealerSeatNo: number | null };
  members: { principalId: string; displayName: string; isOwner: boolean; seatNo: number | null; wind: string | null }[];
  seats: { seatNo: number; principalId: string | null; status: string }[];
  checkedIn: number;
}

test('Phase 2 seating: seatless join, draw, reassignment and legacy finalization', async () => {
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
      return { status: response.status, data: await response.json() as T,
        cookies: response.headers.getSetCookie?.() ?? [] };
    };
    const runId = randomUUID().slice(0, 8);
    let playerNumber = 0;
    const player = async (name: string): Promise<Player> => {
      const email = `seating_${runId}_${playerNumber++}@example.com`;
      const signup = await request<{ user: { id: string } }>('/api/auth/sign-up/email', {
        method: 'POST', body: { email, name, password: 'Password123!StrongEnough' },
      });
      assert.equal(signup.status, 200, `Sign-up for ${email}`);
      const cookie = signup.cookies.map((value) => value.split(';')[0]).join('; ');
      assert.ok(cookie, `Session cookie for ${email}`);
      const me = await request<{ principal: { id: string; displayName: string } }>('/api/me', { cookie });
      assert.equal(me.status, 200);
      return { cookie, principalId: me.data.principal.id, displayName: me.data.principal.displayName };
    };
    const createMatch = async (owner: Player, playerCount: 3 | 4) => {
      const created = await request<{ match: { id: string; joinCode: string } }>('/api/matches', {
        method: 'POST', cookie: owner.cookie, body: { config: { playerCount } },
      });
      assert.equal(created.status, 200);
      return created.data.match.id;
    };
    const detail = async (id: string, viewer: Player) => {
      const response = await request<MatchDetail>(`/api/matches/${id}`, { cookie: viewer.cookie });
      assert.equal(response.status, 200);
      return response.data;
    };
    const token = async (id: string, owner: Player) => {
      const issued = await request<{ token: string }>(`/api/matches/${id}/check-in-tokens`, {
        method: 'POST', cookie: owner.cookie, body: {},
      });
      assert.equal(issued.status, 200);
      return issued.data.token;
    };
    const join = async (id: string, owner: Player, participant: Player, opts: { seatNo?: number; alias?: string } = {}) => {
      const invitation = await token(id, owner);
      return { invitation, response: await request<{
        member: { principalId: string; displayName: string }; seated: boolean; grantId: string; error?: string;
      }>(`/api/matches/${id}/check-ins`, {
        method: 'POST', cookie: participant.cookie, body: { token: invitation, ...opts },
      }) };
    };
    const draw = (id: string, caller: Player) => request<{
      seats: Seat[]; dealerSeatNo: number; error?: string;
    }>(`/api/matches/${id}/seats/draw`, { method: 'POST', cookie: caller.cookie, body: {} });
    const assertDraw = (seats: Seat[], dealer: number, participants: Player[]) => {
      assert.equal(seats.length, participants.length);
      assert.deepEqual(seats.map((seat) => seat.seatNo), participants.map((_, i) => i));
      assert.ok(Number.isInteger(dealer) && dealer >= 0 && dealer < participants.length);
      assert.deepEqual(seats.map((seat) => seat.wind),
        seats.map((seat) => ['E', 'S', 'W', 'N'][(seat.seatNo - dealer + seats.length) % seats.length]));
      assert.deepEqual(new Set(seats.map((seat) => seat.principalId)),
        new Set(participants.map((participant) => participant.principalId)));
      for (const seat of seats) {
        assert.equal(seat.displayName, participants.find((p) => p.principalId === seat.principalId)?.displayName);
      }
    };

    const [owner, second, third, fourth, outsider, replacement] = await Promise.all([
      player('Seating owner'), player('South participant'), player('West participant'),
      player('North participant'), player('Room outsider'), player('Replacement participant'),
    ]);

    // 1. A link/check-in joins an active participant, without occupying a seat, even if seatNo is supplied.
    const id4 = await createMatch(owner, 4);
    const initial = await detail(id4, owner);
    assert.equal(initial.match.seatingDrawnAt, null);
    assert.equal(initial.match.dealerSeatNo, null);
    assert.deepEqual(initial.members.map((member) => member.principalId), [owner.principalId]);
    assert.ok(initial.seats.every((seat) => seat.principalId === null));
    const first = await join(id4, owner, second, { seatNo: 2 });
    assert.equal(first.response.status, 200);
    assert.deepEqual(first.response.data.member, { principalId: second.principalId, displayName: second.displayName });
    assert.equal(first.response.data.seated, false);
    assert.ok(first.response.data.grantId);
    const afterJoin = await detail(id4, second);
    assert.ok(afterJoin.members.some((member) => member.principalId === second.principalId));
    assert.equal(afterJoin.members.find((member) => member.principalId === second.principalId)?.seatNo, null);
    assert.equal(afterJoin.members.find((member) => member.principalId === second.principalId)?.wind, null);
    assert.ok(afterJoin.seats.every((seat) => seat.principalId === null));
    assert.equal(afterJoin.checkedIn, 0);
    const memberRows = await pool.query<{ role: string; status: string; assignments: number; check_ins: number }>(
      `SELECT mm.role, mm.status,
         (SELECT COUNT(*)::int FROM app.seat_assignments sa WHERE sa.member_id = mm.id AND sa.end_hand_no IS NULL) AS assignments,
         (SELECT COUNT(*)::int FROM app.check_ins ci WHERE ci.member_id = mm.id AND ci.invalidated_at IS NULL) AS check_ins
       FROM app.match_members mm WHERE mm.match_id = $1 AND mm.principal_id = $2`,
      [id4, second.principalId],
    );
    assert.deepEqual(memberRows.rows, [{ role: 'participant', status: 'active', assignments: 0, check_ins: 0 }]);

    // 2. Rejoining with a fresh invitation is idempotent, with the same access grant and no seat.
    const freshToken = await token(id4, owner);
    const preview = await request<{
      caller: { principalId: string; isOwner: boolean; isMember: boolean };
      members: MatchDetail['members'];
      seating: { drawn: boolean; dealerSeatNo: number | null; memberCount: number; seatedCount: number };
      seats: MatchDetail['seats'];
    }>(`/api/matches/${id4}/check-in-seats?token=${encodeURIComponent(freshToken)}`,
      { cookie: second.cookie });
    assert.equal(preview.status, 200);
    assert.deepEqual(preview.data.caller, { principalId: second.principalId, isOwner: false, isMember: true });
    assert.deepEqual(preview.data.members.map((member) => member.principalId),
      [owner.principalId, second.principalId]);
    assert.deepEqual(preview.data.seating, {
      drawn: false, dealerSeatNo: null, memberCount: 2, seatedCount: 0,
    });
    assert.ok(preview.data.seats.every((seat) => seat.status === 'empty'));
    const repeat = await request<typeof first.response.data>(`/api/matches/${id4}/check-ins`, {
      method: 'POST', cookie: second.cookie, body: { token: freshToken, seatNo: 0 },
    });
    assert.equal(repeat.status, 200);
    assert.deepEqual(repeat.data, first.response.data);
    const duplicateRows = await pool.query<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM app.match_members WHERE match_id = $1 AND principal_id = $2',
      [id4, second.principalId],
    );
    assert.equal(duplicateRows.rows[0].count, 1);
    const unused = await pool.query<{ revoked_at: Date | null }>(
      'SELECT revoked_at FROM app.match_invitations WHERE match_id = $1 AND hmac_key_id = $2',
      [id4, createHash('sha256').update(freshToken).digest('hex')],
    );
    assert.equal(unused.rows[0].revoked_at, null);

    // 3. Fullness counts active participants, including the seatless owner, not occupied seats.
    const joinedThird = await join(id4, owner, third);
    assert.equal(joinedThird.response.status, 200);
    assert.equal(joinedThird.response.data.seated, false);
    const joinedFourth = await join(id4, owner, fourth);
    assert.equal(joinedFourth.response.status, 200);
    const full = await join(id4, owner, outsider);
    assert.deepEqual([full.response.status, full.response.data.error], [409, 'match_full']);
    assert.equal((await detail(id4, owner)).members.length, 4);
    assert.ok((await detail(id4, owner)).seats.every((seat) => seat.principalId === null));

    // 4. The old manual seat-claim command is retired even for the owner.
    const claim = await request<{ error: string }>(`/api/matches/${id4}/seats/claim`, {
      method: 'POST', cookie: owner.cookie, body: { seatNo: 0 },
    });
    assert.deepEqual([claim.status, claim.data.error], [410, 'seat_claim_retired']);

    // 5. Only the owner may draw, and a room must have exactly the required participants.
    const forbiddenDraw = await draw(id4, second);
    assert.deepEqual([forbiddenDraw.status, forbiddenDraw.data.error], [403, 'forbidden']);
    const incompleteId = await createMatch(owner, 3);
    const incompleteDraw = await draw(incompleteId, owner);
    assert.deepEqual([incompleteDraw.status, incompleteDraw.data.error], [409, 'room_not_full']);
    const noDrawFinalize = await request<{ error: string }>(`/api/matches/${incompleteId}/seats/finalize`, {
      method: 'POST', cookie: owner.cookie, body: {},
    });
    assert.notEqual(noDrawFinalize.status, 200);
    assert.equal((await detail(incompleteId, owner)).match.seatingDrawnAt, null);

    // 6. Four-player draw fills every seat exactly once and rotates winds around the selected dealer.
    const fourDraw = await draw(id4, owner);
    assert.equal(fourDraw.status, 200);
    assertDraw(fourDraw.data.seats, fourDraw.data.dealerSeatNo, [owner, second, third, fourth]);
    const drawnDetail = await detail(id4, owner);
    assert.ok(drawnDetail.match.seatingDrawnAt && !Number.isNaN(Date.parse(drawnDetail.match.seatingDrawnAt)));
    assert.equal(drawnDetail.match.dealerSeatNo, fourDraw.data.dealerSeatNo);
    assert.equal(drawnDetail.checkedIn, 4);
    assert.deepEqual(new Set(drawnDetail.seats.map((seat) => seat.principalId)),
      new Set([owner, second, third, fourth].map((participant) => participant.principalId)));
    const persisted = await pool.query<{ seat_no: number; principal_id: string; drawn_wind: string; initial_wind: string }>(
      `SELECT sa.seat_no, mm.principal_id, mm.drawn_wind, ms.initial_wind
       FROM app.seat_assignments sa JOIN app.match_members mm ON mm.id = sa.member_id
       JOIN app.match_seats ms ON ms.match_id = sa.match_id AND ms.seat_no = sa.seat_no
       WHERE sa.match_id = $1 AND sa.end_hand_no IS NULL ORDER BY sa.seat_no`, [id4],
    );
    assert.deepEqual(persisted.rows.map((row) => [row.seat_no, row.principal_id, row.drawn_wind]),
      fourDraw.data.seats.map((seat) => [seat.seatNo, seat.principalId, seat.wind]));
    const repeatDraw = await draw(id4, owner);
    assert.deepEqual([repeatDraw.status, repeatDraw.data.error], [409, 'seating_already_drawn']);
    const joinedAfterDraw = await request<typeof first.response.data>(`/api/matches/${id4}/check-ins`, {
      method: 'POST', cookie: second.cookie, body: { token: freshToken, seatNo: -10 },
    });
    assert.equal(joinedAfterDraw.status, 200);
    assert.equal(joinedAfterDraw.data.seated, true);
    assert.equal(joinedAfterDraw.data.grantId, first.response.data.grantId);

    // 7. Owner reassignment swaps participants and their persisted winds without changing the dealer seat.
    const beforeSwap = fourDraw.data.seats;
    const swap = await request<{ swapped: boolean }>(`/api/matches/${id4}/seats/reassign`, {
      method: 'POST', cookie: owner.cookie, body: { fromSeatNo: 0, toSeatNo: 1 },
    });
    assert.deepEqual([swap.status, swap.data.swapped], [200, true]);
    const afterSwap = await pool.query<{ seat_no: number; principal_id: string; drawn_wind: string }>(
      `SELECT sa.seat_no, mm.principal_id, mm.drawn_wind FROM app.seat_assignments sa
       JOIN app.match_members mm ON mm.id = sa.member_id
       WHERE sa.match_id = $1 AND sa.end_hand_no IS NULL ORDER BY sa.seat_no`, [id4],
    );
    assert.deepEqual(afterSwap.rows.map((row) => row.principal_id),
      [beforeSwap[1].principalId, beforeSwap[0].principalId, beforeSwap[2].principalId, beforeSwap[3].principalId]);
    assert.deepEqual(afterSwap.rows.map((row) => row.drawn_wind),
      [0, 1, 2, 3].map((seatNo) => ['E', 'S', 'W', 'N'][(seatNo - fourDraw.data.dealerSeatNo + 4) % 4]));
    const swappedMembers = (await detail(id4, owner)).members;
    for (const member of swappedMembers) {
      assert.notEqual(member.seatNo, null);
      assert.equal(member.wind,
        ['E', 'S', 'W', 'N'][(member.seatNo! - fourDraw.data.dealerSeatNo + 4) % 4]);
    }
    assert.equal((await detail(id4, owner)).match.dealerSeatNo, fourDraw.data.dealerSeatNo);

    // 8. Finalization without a request body starts with the seat occupied by East.
    const finalized = await request<{ dealerSeatNo: number; seats: { seatNo: number; points: number }[] }>(
      `/api/matches/${id4}/seats/finalize`, {
        method: 'POST', cookie: owner.cookie,
      });
    assert.equal(finalized.status, 200);
    assert.equal((await detail(id4, owner)).members.find((member) => member.wind === 'E')?.seatNo,
      finalized.data.dealerSeatNo);
    assert.equal(finalized.data.dealerSeatNo, fourDraw.data.dealerSeatNo);
    assert.deepEqual(finalized.data.seats.map((seat) => seat.points), [25000, 25000, 25000, 25000]);
    const hand = await request<{ hand: { dealerSeatNo: number } }>(`/api/matches/${id4}/hands`, {
      method: 'POST', cookie: owner.cookie, body: {},
    });
    assert.equal(hand.status, 200);
    assert.equal(hand.data.hand.dealerSeatNo, fourDraw.data.dealerSeatNo);

    // 9. Three-player draws have only E/S/W; a departure or removal clears draw metadata.
    const id3 = await createMatch(owner, 3);
    assert.equal((await join(id3, owner, second)).response.status, 200);
    assert.equal((await join(id3, owner, third)).response.status, 200);
    const threeDraw = await draw(id3, owner);
    assert.equal(threeDraw.status, 200);
    assertDraw(threeDraw.data.seats, threeDraw.data.dealerSeatNo, [owner, second, third]);
    assert.deepEqual(new Set(threeDraw.data.seats.map((seat) => seat.wind)), new Set(['E', 'S', 'W']));
    const leave = await request<{ left: boolean }>(`/api/matches/${id3}/leave`, {
      method: 'POST', cookie: second.cookie, body: {},
    });
    assert.deepEqual([leave.status, leave.data.left], [200, true]);
    const leftView = await detail(id3, owner);
    assert.equal(leftView.match.seatingDrawnAt, null);
    assert.equal(leftView.match.dealerSeatNo, null);
    assert.ok(leftView.seats.every((seat) => seat.principalId === null));
    assert.equal(leftView.checkedIn, 0);
    const leftWinds = await pool.query<{ drawn_wind: string | null }>(
      `SELECT drawn_wind FROM app.match_members WHERE match_id = $1 AND status = 'active'`, [id3],
    );
    assert.ok(leftWinds.rows.every((row) => row.drawn_wind === null));
    assert.equal((await join(id3, owner, fourth)).response.status, 200);
    const redrawn = await draw(id3, owner);
    assert.equal(redrawn.status, 200);
    assertDraw(redrawn.data.seats, redrawn.data.dealerSeatNo, [owner, third, fourth]);
    const remove = await request<{ removed: boolean }>(
      `/api/matches/${id3}/members/${third.principalId}/remove`, {
        method: 'POST', cookie: owner.cookie, body: {},
      });
    assert.deepEqual([remove.status, remove.data.removed], [200, true]);
    const removedView = await detail(id3, owner);
    assert.equal(removedView.match.seatingDrawnAt, null);
    assert.equal(removedView.match.dealerSeatNo, null);
    assert.ok(removedView.seats.every((seat) => seat.principalId === null));
    assert.equal(removedView.checkedIn, 0);
    const remainingWinds = await pool.query<{ drawn_wind: string | null }>(
      `SELECT drawn_wind FROM app.match_members WHERE match_id = $1 AND status = 'active'`, [id3],
    );
    assert.ok(remainingWinds.rows.every((row) => row.drawn_wind === null));
    assert.equal((await join(id3, owner, replacement)).response.status, 200);
    const afterRemovalDraw = await draw(id3, owner);
    assert.equal(afterRemovalDraw.status, 200);
    assertDraw(afterRemovalDraw.data.seats, afterRemovalDraw.data.dealerSeatNo, [owner, fourth, replacement]);
    const drawnWithConflictingDealer = await request<{ dealerSeatNo: number }>(
      `/api/matches/${id3}/seats/finalize`, {
        method: 'POST', cookie: owner.cookie,
        body: { dealerSeatNo: (afterRemovalDraw.data.dealerSeatNo + 1) % 3 },
      });
    assert.equal(drawnWithConflictingDealer.status, 200);
    assert.equal(drawnWithConflictingDealer.data.dealerSeatNo, afterRemovalDraw.data.dealerSeatNo);

    // 10. Historical fully assigned/checked-in rooms remain finalizable without a Phase 2 draw.
    const legacyId = await createMatch(owner, 4);
    const legacyPlayers = [owner, second, third, replacement];
    const legacyMatch = await pool.query<{ rules_hash: string }>(
      'SELECT rules_hash FROM app.matches WHERE id = $1', [legacyId],
    );
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const [seatNo, participant] of legacyPlayers.entries()) {
        const member = seatNo === 0
          ? await client.query<{ id: string }>(
            'SELECT id FROM app.match_members WHERE match_id = $1 AND principal_id = $2',
            [legacyId, participant.principalId],
          )
          : await client.query<{ id: string }>(
            `INSERT INTO app.match_members (match_id, principal_id, role, status)
             VALUES ($1, $2, 'participant', 'active') RETURNING id`,
            [legacyId, participant.principalId],
          );
        const assignment = await client.query<{ id: string }>(
          `INSERT INTO app.seat_assignments (match_id, seat_no, member_id, start_hand_no, confirmed_by)
           VALUES ($1, $2, $3, 0, $4) RETURNING id`,
          [legacyId, seatNo, member.rows[0].id, owner.principalId],
        );
        await client.query(
          `INSERT INTO app.check_ins (match_id, member_id, seat_assignment_id, rules_hash, method)
           VALUES ($1, $2, $3, $4, 'host_confirm')`,
          [legacyId, member.rows[0].id, assignment.rows[0].id, legacyMatch.rows[0].rules_hash],
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    const beforeLegacy = await detail(legacyId, owner);
    assert.equal(beforeLegacy.match.seatingDrawnAt, null);
    assert.equal(beforeLegacy.match.dealerSeatNo, null);
    assert.equal(beforeLegacy.checkedIn, 4);
    const legacyDraw = await draw(legacyId, owner);
    assert.deepEqual([legacyDraw.status, legacyDraw.data.error], [409, 'seating_already_complete']);
    assert.equal((await detail(legacyId, owner)).match.seatingDrawnAt, null);
    const legacyFinalize = await request<{ dealerSeatNo: number; seats: { seatNo: number }[] }>(
      `/api/matches/${legacyId}/seats/finalize`, {
        method: 'POST', cookie: owner.cookie, body: { dealerSeatNo: 2 },
      });
    assert.equal(legacyFinalize.status, 200);
    assert.equal(legacyFinalize.data.dealerSeatNo, 2);
    assert.deepEqual(legacyFinalize.data.seats.map((seat) => seat.seatNo), [0, 1, 2, 3]);
    const legacyHand = await request<{ hand: { dealerSeatNo: number } }>(`/api/matches/${legacyId}/hands`, {
      method: 'POST', cookie: owner.cookie, body: {},
    });
    assert.equal(legacyHand.status, 200);
    assert.equal(legacyHand.data.hand.dealerSeatNo, 2);
  } finally {
    await app.close();
    await pool.end();
  }
});
