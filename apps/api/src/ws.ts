import { createHash, randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { WebSocket } from '@fastify/websocket';
import { requirePrincipal } from './auth.js';
import { pool } from './db.js';
import { checkMatchAccess } from './routes/matches.js';

export type WsEventType =
  | 'check_in'
  | 'join_approved'
  | 'seats_finalized'
  | 'hand_started'
  | 'marks_changed'
  | 'hand_settled'
  | 'match_finished'
  | 'settlement_confirmed';

interface MatchConnection {
  socket: WebSocket;
  principalId: string;
  authSessionRef: string;
  pending: Promise<void>;
}

const matchRooms = new Map<string, Set<MatchConnection>>();

async function hasLiveSession(authSessionRef: string, principalId: string): Promise<boolean> {
  const res = await pool.query(
    `SELECT 1
     FROM public."session" s
     JOIN public."user" u ON u."id" = s."userId"
     LEFT JOIN public.auth_principal_map apm ON apm.auth_user_id = u."id"
     JOIN app.principals p ON p.id = $2
     WHERE s."id" = $1
       AND s."expiresAt" > now()
       AND p.status = 'active'
       AND (p.auth_user_id = u."id" OR apm.principal_id = p.id)
     LIMIT 1`,
    [authSessionRef, principalId],
  );
  return (res.rowCount ?? 0) > 0;
}

export function broadcastMatchEvent(matchId: string, type: WsEventType, payload: unknown): void {
  const room = matchRooms.get(matchId);
  if (!room || room.size === 0) return;
  const message = JSON.stringify({ type, payload });
  for (const connection of room) {
    // Tickets authorize an upgrade, not indefinite access to future events.
    // Chain checks per connection to preserve broadcast order.
    connection.pending = connection.pending.then(async () => {
      if (connection.socket.readyState !== 1) return;
      if (
        !(await hasLiveSession(connection.authSessionRef, connection.principalId)) ||
        (await checkMatchAccess(matchId, connection.principalId)) !== 'allowed'
      ) {
        connection.socket.close(1008, 'Session revoked or match access denied');
        return;
      }
      if (connection.socket.readyState === 1) connection.socket.send(message);
    }).catch(() => {
      connection.socket.close(1011, 'Subscription validation error');
    });
  }
}

export function registerWsRoutes(app: FastifyInstance): void {
  app.post<{ Params: { id: string } }>('/api/matches/:id/ws-tickets', async (req, reply) => {
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

    const ticket = randomBytes(24).toString('base64url');
    const tokenHash = createHash('sha256').update(ticket).digest('hex');
    const expiresAt = new Date(Date.now() + 30_000);

    await pool.query(
      `INSERT INTO app.ws_tickets (token_hash, principal_id, auth_session_ref, match_id, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [tokenHash, principal.id, principal.sessionId, matchId, expiresAt],
    );

    return {
      ticket,
      expiresAt: expiresAt.toISOString(),
    };
  });

  // Design tension: the ws-ticket travels in the URL query string because the browser
  // WebSocket API cannot attach custom Authorization headers.
  // Mitigation: single-use short-lived (30s) SHA-256 hashed ticket + re-validating that
  // the issuing session is still live in Better Auth's session store (not revoked/expired)
  // and that the principal remains active and still has match access at upgrade time.
  app.get<{ Params: { id: string }; Querystring: { ticket?: string } }>(
    '/ws/matches/:id',
    { websocket: true },
    async (socket, req) => {
      const matchId = req.params.id;
      const ticket = req.query?.ticket;

      if (!ticket || typeof ticket !== 'string') {
        socket.close(1008, 'Missing ticket');
        return;
      }

      const tokenHash = createHash('sha256').update(ticket).digest('hex');
      let connection: MatchConnection;
      try {
        const res = await pool.query<{ principal_id: string; auth_session_ref: string }>(
          `UPDATE app.ws_tickets
           SET consumed_at = now()
           WHERE token_hash = $1
             AND match_id = $2
             AND consumed_at IS NULL
             AND expires_at > now()
           RETURNING principal_id, auth_session_ref`,
          [tokenHash, matchId],
        );

        if (res.rowCount === 0) {
          socket.close(1008, 'Invalid or expired ticket');
          return;
        }

        const { principal_id: principalId, auth_session_ref: authSessionRef } = res.rows[0];
        if (!(await hasLiveSession(authSessionRef, principalId))) {
          socket.close(1008, 'Session revoked or expired');
          return;
        }

        const access = await checkMatchAccess(matchId, principalId);
        if (access !== 'allowed') {
          socket.close(1008, 'Match access denied');
          return;
        }
        connection = { socket, principalId, authSessionRef, pending: Promise.resolve() };

      } catch {
        socket.close(1011, 'Ticket validation error');
        return;
      }

      if (socket.readyState !== 1) return;
      let room = matchRooms.get(matchId);
      if (!room) {
        room = new Set<MatchConnection>();
        matchRooms.set(matchId, room);
      }
      room.add(connection);

      const cleanup = () => {
        const currentRoom = matchRooms.get(matchId);
        if (currentRoom) {
          currentRoom.delete(connection);
          if (currentRoom.size === 0) {
            matchRooms.delete(matchId);
          }
        }
      };

      socket.on('close', cleanup);
      socket.on('error', cleanup);
    },
  );
}
