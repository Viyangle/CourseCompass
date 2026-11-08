/**
 * 最小可用 CookieJar。
 *
 * 为什么必须自己实现：Node 的 fetch 不带 cookie 存储，而 ehall 的会话完全依赖 cookie
 * （CAS 的 CASTGC、ehall 的 JSESSIONID、以及网关的 _WEU）。用 `fetch` + 手工重定向
 * 才能把"CAS → ticket → ehall 会话"这条链路走通。
 *
 * 只实现本项目用得到的能力：域名匹配、路径匹配、过期、序列化。
 */

export interface StoredCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  /** epoch ms；0 表示会话 cookie */
  expires?: number;
  secure?: boolean;
  httpOnly?: boolean;
}

const SESSION_COOKIE_MAX_AGE = 30 * 60 * 1000;

export class CookieJar {
  private cookies = new Map<string, StoredCookie>();

  private key(cookie: StoredCookie): string {
    return `${cookie.domain}|${cookie.path}|${cookie.name}`;
  }

  set(cookie: StoredCookie): void {
    this.cookies.set(this.key(cookie), cookie);
  }

  setFromSetCookie(url: URL, headers: string[]): void {
    for (const header of headers) {
      const parsed = parseSetCookie(header, url);
      if (!parsed) continue;
      if (parsed.expires !== undefined && parsed.expires <= Date.now()) {
        this.cookies.delete(this.key(parsed));
        continue;
      }
      this.cookies.set(this.key(parsed), parsed);
    }
  }

  /** 生成发往某 URL 的 Cookie 头。 */
  header(url: URL, now = Date.now()): string {
    const pairs: string[] = [];
    for (const cookie of this.cookies.values()) {
      if (cookie.expires !== undefined && cookie.expires !== 0 && cookie.expires <= now) continue;
      if (!domainMatches(url.hostname, cookie.domain)) continue;
      if (!url.pathname.startsWith(cookie.path)) continue;
      if (cookie.secure && url.protocol !== 'https:') continue;
      pairs.push(`${cookie.name}=${cookie.value}`);
    }
    return pairs.join('; ');
  }

  get(name: string): StoredCookie | undefined {
    for (const cookie of this.cookies.values()) {
      if (cookie.name === name) return cookie;
    }
    return undefined;
  }

  has(name: string): boolean {
    return this.get(name) !== undefined;
  }

  toJSON(): StoredCookie[] {
    return [...this.cookies.values()];
  }

  static fromJSON(cookies: StoredCookie[]): CookieJar {
    const jar = new CookieJar();
    for (const cookie of cookies) jar.set(cookie);
    return jar;
  }
}

function domainMatches(host: string, domain: string): boolean {
  const normalized = domain.startsWith('.') ? domain.slice(1) : domain;
  return host === normalized || host.endsWith(`.${normalized}`);
}

export function parseSetCookie(header: string, url: URL): StoredCookie | null {
  const parts = header.split(';').map((part) => part.trim());
  const first = parts.shift();
  if (!first) return null;
  const eq = first.indexOf('=');
  if (eq <= 0) return null;
  const name = first.slice(0, eq).trim();
  const value = first.slice(eq + 1).trim();
  if (!name) return null;

  const cookie: StoredCookie = {
    name,
    value,
    domain: url.hostname,
    path: defaultPath(url.pathname),
    expires: undefined,
  };

  for (const part of parts) {
    const [rawKey, ...rest] = part.split('=');
    const key = rawKey.trim().toLowerCase();
    const attr = rest.join('=').trim();
    if (key === 'domain' && attr) cookie.domain = attr;
    else if (key === 'path' && attr) cookie.path = attr;
    else if (key === 'secure') cookie.secure = true;
    else if (key === 'httponly') cookie.httpOnly = true;
    else if (key === 'max-age' && attr) {
      const seconds = Number(attr);
      if (Number.isFinite(seconds)) cookie.expires = Date.now() + seconds * 1000;
    } else if (key === 'expires' && attr) {
      const date = new Date(attr);
      if (!Number.isNaN(date.getTime())) cookie.expires = date.getTime();
    }
  }

  // 没有显式过期时间时，给一个保守的会话上限，避免"以为还登录着"
  if (cookie.expires === undefined) cookie.expires = Date.now() + SESSION_COOKIE_MAX_AGE;
  return cookie;
}

function defaultPath(pathname: string): string {
  if (!pathname.startsWith('/')) return '/';
  const index = pathname.lastIndexOf('/');
  if (index <= 0) return '/';
  return pathname.slice(0, index);
}
