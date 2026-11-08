/**
 * 带 Cookie 的 HTTP 客户端：手工处理重定向，才能完整记录 CAS 的跳转链路。
 *
 * 安全约束：
 * - 只允许访问白名单域名（防止 SSRF）；
 * - 不记录响应正文到日志（可能含个人成绩）；
 * - 超时 15 秒，重定向最多 8 次。
 */

import { CookieJar } from './cookies.js';

export interface TraceStep {
  url: string;
  status: number;
  location?: string;
  note?: string;
  elapsedMs: number;
}

export interface RequestOptions {
  url: string;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
  jar: CookieJar;
  allowedHosts: string[];
  maxRedirects?: number;
  timeoutMs?: number;
  trace?: TraceStep[];
}

export interface RequestResult {
  url: string;
  status: number;
  headers: Headers;
  text: string;
}

export class HttpError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status = 0,
  ) {
    super(message);
  }
}

const DEFAULT_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
};

function assertAllowed(url: URL, allowedHosts: string[]): void {
  if (!allowedHosts.includes(url.hostname)) {
    throw new HttpError(`不在允许访问的域名列表中：${url.hostname}`, 'HOST_NOT_ALLOWED');
  }
}

export async function requestWithJar(options: RequestOptions): Promise<RequestResult> {
  const { jar, allowedHosts, trace = [] } = options;
  const maxRedirects = options.maxRedirects ?? 8;
  const timeoutMs = options.timeoutMs ?? 15_000;

  let current = new URL(options.url);
  let method = options.method ?? 'GET';
  let body = options.body;
  let headers = { ...DEFAULT_HEADERS, ...options.headers };

  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    assertAllowed(current, allowedHosts);
    const started = Date.now();
    const cookieHeader = jar.header(current);
    const response = await fetch(current, {
      method,
      headers: {
        ...headers,
        ...(cookieHeader ? { Cookie: cookieHeader } : {}),
        Referer: headers.Referer ?? 'https://ehall.nju.edu.cn/',
      },
      body,
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });

    const setCookies = response.headers.getSetCookie?.() ?? [];
    if (setCookies.length > 0) jar.setFromSetCookie(current, setCookies);

    const location = response.headers.get('location');
    trace.push({
      url: current.toString(),
      status: response.status,
      location: location ?? undefined,
      elapsedMs: Date.now() - started,
    });

    if (response.status >= 300 && response.status < 400 && location) {
      current = new URL(location, current);
      // 303 或登录后的 302 一律降级为 GET，并丢弃 body
      if (response.status === 303 || (method === 'POST' && response.status !== 307 && response.status !== 308)) {
        method = 'GET';
        body = undefined;
        headers = { ...headers };
        delete headers['Content-Type'];
      }
      continue;
    }

    const text = await response.text();
    return { url: current.toString(), status: response.status, headers: response.headers, text };
  }

  throw new HttpError('重定向次数过多，可能陷入了登录循环', 'TOO_MANY_REDIRECTS');
}

export function isLoginPage(url: string, html: string): boolean {
  return url.includes('authserver.nju.edu.cn') || html.includes('统一身份认证');
}
