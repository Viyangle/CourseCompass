import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { SessionInfo } from '@planner/shared';
import { config } from '../config.js';
import { clearSessionCookie, issueSession, ok, requireSession, sendError, AppError } from '../lib/http.js';
import { casLogin } from '../adapters/ehall/cas.js';
import { CookieJar } from '../adapters/ehall/cookies.js';
import { sessions } from '../services/session.js';
import type { Store } from '../store/db.js';

const loginSchema = z.discriminatedUnion('method', [
  z.object({ method: z.literal('demo') }),
  z.object({
    method: z.literal('cas'),
    username: z.string().min(4).max(32),
    password: z.string().min(1).max(128),
  }),
  z.object({ method: z.literal('cookie'), cookie: z.string().min(10) }),
]);

function toSessionInfo(session: ReturnType<typeof sessions.create>, store: Store, offline: boolean): SessionInfo {
  const profile = session.profile ?? store.data.profile;
  return {
    authenticated: true,
    method: session.method,
    profile,
    expiresIn: config.sessionTtl,
    offline,
  };
}

/** 把浏览器里复制的 "a=1; b=2" 变成可用的 cookie 罐。 */
function jarFromCookieHeader(header: string): CookieJar {
  const jar = new CookieJar();
  for (const domain of ['.nju.edu.cn', 'ehallapp.nju.edu.cn', 'ehall.nju.edu.cn', 'authserver.nju.edu.cn']) {
    for (const pair of header.split(';')) {
      const [name, ...rest] = pair.trim().split('=');
      if (!name || rest.length === 0) continue;
      jar.set({
        name: name.trim(),
        value: rest.join('=').trim(),
        domain,
        path: '/',
        expires: Date.now() + config.sessionTtl * 1000,
      });
    }
  }
  return jar;
}

export async function registerAuthRoutes(app: FastifyInstance, store: Store): Promise<void> {
  app.post('/api/auth/login', async (request, reply) => {
    try {
      const body = loginSchema.parse(request.body);

      if (body.method === 'demo') {
        const session = sessions.create('demo');
        session.profile = store.data.profile;
        issueSession(reply, session);
        return ok<SessionInfo>(toSessionInfo(session, store, true));
      }

      if (body.method === 'cookie') {
        const jar = jarFromCookieHeader(body.cookie);
        const session = sessions.create('cookie', jar);
        session.profile = store.data.profile;
        issueSession(reply, session);
        return ok<SessionInfo>(toSessionInfo(session, store, false));
      }

      const result = await casLogin({ username: body.username, password: body.password });
      if (!result.ok) {
        const trace = result.steps.map((step) => ({ url: step.url, status: step.status, note: step.note }));
        throw new AppError(
          result.error?.code ?? 'CAS_FAILED',
          result.error?.message ?? '登录失败',
          401,
          { hint: result.error?.hint, trace },
        );
      }

      const session = sessions.create('cas', result.jar);
      session.profile = { ...store.data.profile, studentId: body.username, demo: false };
      session.trace = result.steps;
      issueSession(reply, session);
      return ok<SessionInfo>(toSessionInfo(session, store, false));
    } catch (error) {
      if (error instanceof z.ZodError) {
        reply.status(400).send({ ok: false, error: { code: 'BAD_REQUEST', message: '登录参数不正确' } });
        return;
      }
      sendError(reply, error);
    }
  });

  app.post('/api/auth/logout', async (request, reply) => {
    const session = requireSession(request);
    sessions.destroy(session.id);
    clearSessionCookie(reply);
    return ok({ loggedOut: true });
  });

  app.get('/api/session', async (request) => {
    const raw = (request.cookies as Record<string, string | undefined>).planner_session;
    const session = sessions.get(raw);
    if (!session) {
      return ok<SessionInfo>({ authenticated: false, offline: config.demoMode });
    }
    return ok<SessionInfo>(toSessionInfo(session, store, config.demoMode || session.method === 'demo'));
  });
}
