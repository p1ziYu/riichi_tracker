import './env.js';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import Fastify from 'fastify';
import { registerAuthRoutes } from './auth.js';
import { ensureAuthSchema, pool } from './db.js';
import { registerHandsRoutes } from './routes/hands.js';
import { registerMatchesRoutes } from './routes/matches.js';
import { registerRulesetsRoutes } from './routes/rulesets.js';
import { registerWsRoutes } from './ws.js';

export async function buildApp() {
  const app = Fastify({ logger: true });

  await app.register(cors, {
    origin: true,
    credentials: true,
  });

  await app.register(websocket);

  // Tolerate empty JSON bodies (e.g. POST {} or POST with empty payload and Content-Type: application/json)
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    const str = typeof body === 'string' ? body.trim() : '';
    if (!str) {
      done(null, {});
      return;
    }
    try {
      done(null, JSON.parse(str));
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  app.get('/health', async () => ({ ok: true, service: 'riichi-api' }));
  app.get('/api/health', async () => {
    const r = await pool.query('SELECT 1 AS one');
    return { ok: true, db: r.rows[0].one === 1 };
  });

  registerAuthRoutes(app);
  registerRulesetsRoutes(app);
  registerMatchesRoutes(app);
  registerHandsRoutes(app);
  registerWsRoutes(app);

  return app;
}

const isMain =
  process.argv[1] &&
  (process.argv[1].endsWith('/src/index.ts') || process.argv[1].endsWith('/dist/index.js'));

if (isMain) {
  const port = Number(process.env.PORT ?? 3101);
  ensureAuthSchema()
    .then(() => buildApp())
    .then((app) =>
      app.listen({ port, host: '127.0.0.1' }).then(() => {
        app.log.info(`riichi-api listening on 127.0.0.1:${port}`);
      }),
    )
    .catch((err) => {
      console.error('Failed to start riichi-api:', err);
      process.exit(1);
    });
}
