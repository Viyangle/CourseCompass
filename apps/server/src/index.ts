/**
 * 服务端入口。
 *
 * 运行形态刻意保持"一个进程"：静态资源 + API 同源，避免跨域与 Cookie 的麻烦，
 * 也方便同学把项目拷到另一台电脑上直接 `pnpm dev`。
 */

import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { config } from './config.js';
import { Store } from './store/db.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerDataRoutes } from './routes/data.js';
import { registerPlanRoutes } from './routes/plans.js';
import { registerDevRoutes } from './routes/dev.js';
import { sessions } from './services/session.js';
import { fail } from './lib/http.js';

const here = dirname(fileURLToPath(import.meta.url));
const webDist = resolve(here, '../../web/dist');

export async function buildServer(store: Store) {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      redact: ['req.headers.cookie', 'req.headers.authorization', 'req.body.password'],
      transport:
        process.env.NODE_ENV === 'production'
          ? undefined
          : { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } },
    },
  });

  await app.register(cookie);

  app.get('/api/health', async () => ({
    ok: true,
    data: { status: 'up', demoMode: config.demoMode, devTools: config.devTools, time: new Date().toISOString() },
  }));

  await registerAuthRoutes(app, store);
  await registerDataRoutes(app, store);
  await registerPlanRoutes(app, store);
  if (config.devTools) await registerDevRoutes(app, store);

  app.setErrorHandler((error, _request, reply) => {
    app.log.error({ err: error }, 'unhandled error');
    reply.status(500).send(fail('INTERNAL_ERROR', '服务器内部错误'));
  });

  if (existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist, prefix: '/' });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api/')) {
        reply.status(404).send(fail('NOT_FOUND', '接口不存在'));
        return;
      }
      reply.sendFile('index.html');
    });
  }

  return app;
}

async function main(): Promise<void> {
  const store = await Store.open(config.dataDir);
  sessions.attach(join(config.dataDir, 'sessions.json'));
  await sessions.load();
  const app = await buildServer(store);

  setInterval(() => sessions.sweep(), 60_000).unref();
  process.on('SIGINT', async () => {
    await store.flush();
    await app.close();
    process.exit(0);
  });

  await app.listen({ port: config.port, host: config.host });
  app.log.info(
    { demoMode: config.demoMode, dataDir: config.dataDir, webDist: existsSync(webDist) ? webDist : '未构建（请用 Vite 开发服务器）' },
    '学业规划系统已启动',
  );
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
