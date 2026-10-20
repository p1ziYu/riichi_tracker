import Fastify from 'fastify';
import { Pool } from 'pg';

const app = Fastify({ logger: true });
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

app.get('/health', async () => ({ ok: true, service: 'riichi-api' }));
app.get('/api/health', async () => {
  const r = await pool.query('SELECT 1 AS one');
  return { ok: true, db: r.rows[0].one === 1 };
});

// Stubs: match create/read logic lands later.
app.post('/api/matches', async (_req, reply) => reply.code(501).send({ error: 'not_implemented' }));
app.get('/api/matches/:id', async (_req, reply) => reply.code(501).send({ error: 'not_implemented' }));

const port = Number(process.env.PORT ?? 3101);
app.listen({ port, host: '127.0.0.1' }).then(() => {
  app.log.info(`riichi-api listening on 127.0.0.1:${port}`);
});
