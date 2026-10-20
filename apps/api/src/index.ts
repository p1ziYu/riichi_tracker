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

const ALLOWED_CORS_ORIGINS: Record<string, true> = {
  'https://riichi.p1ziyu.com': true,
  'http://127.0.0.1:5173': true,
  'http://localhost:5173': true,
  'capacitor://localhost': true,
  'https://localhost': true,
};

export async function buildApp() {
  const app = Fastify({ logger: true });

  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin) {
        cb(null, false);
        return;
      }
      cb(null, ALLOWED_CORS_ORIGINS[origin] === true ? origin : false);
    },
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
      const syntaxErr = err as Error & { statusCode?: number };
      syntaxErr.statusCode = 400;
      done(syntaxErr, undefined);
    }
  });

  app.setErrorHandler((err: Error & { statusCode?: number; code?: string }, _req, reply) => {
    if (err.code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
      return reply.code(413).send({
        error: 'payload_too_large',
        message: 'Request body is too large',
      });
    }
    if (err.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE') {
      return reply.code(415).send({
        error: 'unsupported_media_type',
        message: 'Unsupported request content type',
      });
    }
    if (err instanceof SyntaxError) {
      return reply.code(400).send({
        error: 'invalid_json',
        message: 'Malformed JSON request body',
      });
    }
    const status =
      typeof err.statusCode === 'number' && err.statusCode >= 400 && err.statusCode < 600
        ? err.statusCode
        : 500;
    if (status >= 500) {
      app.log.error(err);
      return reply.code(status).send({
        error: 'internal_error',
        message: 'Internal server error',
      });
    }
    return reply.code(status).send({
      error: 'bad_request',
      message: 'Bad request',
    });
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
