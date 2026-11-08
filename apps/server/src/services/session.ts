/**
 * 会话管理。
 *
 * 三条硬规则：
 * 1. 会话只存在内存里，服务重启即失效 —— 演示机不需要持久化别人的登录态；
 * 2. 密码从不进入会话对象，只用一次；
 * 3. 会话令牌用 HttpOnly + SameSite=Lax 的 cookie 承载，前端拿不到，XSS 也偷不走。
 */

import type { AuthMethod, StudentProfile } from '@planner/shared';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { randomId, seal, unseal, type SealedBox } from '../lib/crypto.js';
import { CookieJar } from '../adapters/ehall/cookies.js';
import type { TraceStep } from '../adapters/ehall/http.js';
import { config } from '../config.js';

export interface SessionState {
  id: string;
  method: AuthMethod;
  createdAt: number;
  lastSeen: number;
  profile?: StudentProfile;
  /** 加密后的 cookie 罐，避免被误打进日志 */
  jarBox?: SealedBox;
  trace?: TraceStep[];
}

const SECRET = randomId(32);

export class SessionStore {
  private sessions = new Map<string, SessionState>();
  private persistFile?: string;

  /** 只持久化演示会话：真实会话含 cookie，重启即失效是安全设计的一部分。 */
  attach(file: string): void {
    this.persistFile = file;
  }

  async load(): Promise<void> {
    if (!this.persistFile || !existsSync(this.persistFile)) return;
    try {
      const raw = JSON.parse(await readFile(this.persistFile, 'utf8')) as SessionState[];
      const now = Date.now();
      for (const session of raw) {
        if (session.method !== 'demo') continue;
        if (now - session.lastSeen > config.sessionTtl * 1000) continue;
        this.sessions.set(session.id, session);
      }
    } catch {
      /* 文件损坏时忽略，重新登录即可 */
    }
  }

  private persist(): void {
    if (!this.persistFile) return;
    const demo = [...this.sessions.values()].filter((session) => session.method === 'demo');
    void writeFile(this.persistFile, JSON.stringify(demo, null, 2), 'utf8').catch(() => undefined);
  }

  create(method: AuthMethod, jar?: CookieJar): SessionState {
    const now = Date.now();
    const session: SessionState = {
      id: randomId(24),
      method,
      createdAt: now,
      lastSeen: now,
      jarBox: jar ? seal(JSON.stringify(jar.toJSON()), SECRET) : undefined,
    };
    this.sessions.set(session.id, session);
    this.persist();
    return session;
  }

  get(id: string | undefined): SessionState | undefined {
    if (!id) return undefined;
    const session = this.sessions.get(id);
    if (!session) return undefined;
    if (Date.now() - session.lastSeen > config.sessionTtl * 1000) {
      this.sessions.delete(id);
      return undefined;
    }
    session.lastSeen = Date.now();
    return session;
  }

  destroy(id: string | undefined): void {
    if (!id) return;
    this.sessions.delete(id);
    this.persist();
  }

  getJar(session: SessionState): CookieJar | undefined {
    if (!session.jarBox) return undefined;
    try {
      return CookieJar.fromJSON(JSON.parse(unseal(session.jarBox, SECRET)));
    } catch {
      return undefined;
    }
  }

  setJar(session: SessionState, jar: CookieJar): void {
    session.jarBox = seal(JSON.stringify(jar.toJSON()), SECRET);
  }

  /** 清理过期会话，避免内存无限增长。 */
  sweep(): void {
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      if (now - session.lastSeen > config.sessionTtl * 1000) this.sessions.delete(id);
    }
  }
}

export const sessions = new SessionStore();
