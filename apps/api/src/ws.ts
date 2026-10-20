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

const matchRooms = new Map<string, Set<WebSocket>>();

export function broadcastMatchEvent(matchId: string, type: WsEventType, payload: unknown): void {
  const room = matchRooms.get(matchId);
  if (!room || room.size === 0) return;
  const message = JSON.stringify({ type, payload });
  for (const socket of room) {
    if (socket.readyState === 1) {
      socket.send(message);
    }
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
      [tokenHash, principal.id, principal.sessionId || principal.id, matchId, expiresAt],
    );

    return {
      ticket,
      expiresAt: expiresAt.toISOString(),
    };
  });

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
      try {
        const res = await pool.query<{ principal_id: string }>(
          `UPDATE app.ws_tickets
           SET consumed_at = now()
           WHERE token_hash = $1
             AND match_id = $2
             AND consumed_at IS NULL
             AND expires_at > now()
           RETURNING principal_id`,
          [tokenHash, matchId],
        );

        if (res.rowCount === 0) {
          socket.close(1008, 'Invalid or expired ticket');
          return;
        }
      } catch {
        socket.close(1011, 'Ticket validation error');
        return;
      }

      let room = matchRooms.get(matchId);
      if (!room) {
        room = new Set<WebSocket>();
        matchRooms.set(matchId, room);
      }
      room.add(socket);

      const cleanup = () => {
        const currentRoom = matchRooms.get(matchId);
        if (currentRoom) {
          currentRoom.delete(socket);
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
