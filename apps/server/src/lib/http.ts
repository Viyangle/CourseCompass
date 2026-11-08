import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiErr, ApiOk } from '@planner/shared';
import { sessions, type SessionState } from '../services/session.js';

export class AppError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export function ok<T>(data: T): ApiOk<T> {
  return { ok: true, data };
}

export function fail(code: string, message: string, details?: unknown): ApiErr {
  return { ok: false, error: { code, message, details } };
}

export function sendError(reply: FastifyReply, error: unknown): void {
  if (error instanceof AppError) {
    reply.status(error.status).send(fail(error.code, error.message, error.details));
    return;
  }
  const message = error instanceof Error ? error.message : '服务器内部错误';
  reply.status(500).send(fail('INTERNAL_ERROR', message));
}

const SESSION_COOKIE = 'planner_session';

export function issueSession(reply: FastifyReply, session: SessionState): void {
  void reply.setCookie(SESSION_COOKIE, session.id, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 1800,
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  void reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

/** 取当前会话；没有或过期抛 401，由前端跳登录页。 */
export function requireSession(request: FastifyRequest): SessionState {
  const raw = (request.cookies as Record<string, string | undefined>)[SESSION_COOKIE];
  const session = sessions.get(raw);
  if (!session) {
    throw new AppError('UNAUTHORIZED', '会话已过期，请重新登录', 401);
  }
  return session;
}

export function optionalSession(request: FastifyRequest): SessionState | undefined {
  const raw = (request.cookies as Record<string, string | undefined>)[SESSION_COOKIE];
  return sessions.get(raw);
}

export { SESSION_COOKIE };
