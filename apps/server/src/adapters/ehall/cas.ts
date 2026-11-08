/**
 * 南京大学统一身份认证（金智 CAS）登录。
 *
 * 链路（与 docs/01-数据获取与合规.md 一一对应）：
 *   1. GET https://ehall.nju.edu.cn/            → 302 到 authserver，带 service 参数
 *   2. GET /authserver/login?service=...        → 拿到 execution / pwdEncryptSalt
 *   3. POST 同一地址（用户名 + 加密后的密码）    → 302 回 ehall，带 ticket
 *   4. GET ehall 带 ticket                      → ehall 建立自己的会话 cookie
 *
 * 设计取舍：
 * - 密码只在内存里存在一次，用于构造加密串，随后立即丢弃；不写日志、不落盘。
 * - 遇到验证码/二次验证时 **不尝试绕过**，直接返回 CAPTCHA_REQUIRED，由前端引导用户
 *   走"浏览器登录后粘贴 Cookie"的备用通道。这是合规底线，也是稳定的降级方案。
 */

import { encryptCasPassword } from '../../lib/crypto.js';
import { config } from '../../config.js';
import { CookieJar } from './cookies.js';
import { HttpError, isLoginPage, requestWithJar, type TraceStep } from './http.js';

export interface CasFieldBundle {
  execution: string;
  salt: string;
  actionUrl: string;
  hasCaptcha: boolean;
}

export interface CasLoginResult {
  ok: boolean;
  jar: CookieJar;
  steps: TraceStep[];
  /** 登录成功后落到的最终地址 */
  finalUrl?: string;
  error?: { code: string; message: string; hint?: string };
}

function extractHidden(html: string, name: string): string | undefined {
  const byName = new RegExp(`name=["']${name}["'][^>]*value=["']([^"']*)["']`, 'i').exec(html);
  if (byName?.[1]) return byName[1];
  const byId = new RegExp(`id=["']${name}["'][^>]*value=["']([^"']*)["']`, 'i').exec(html);
  return byId?.[1];
}

export function parseCasLoginForm(html: string, url: string): CasFieldBundle {
  const execution = extractHidden(html, 'execution');
  const salt = extractHidden(html, 'pwdEncryptSalt');
  if (!execution || !salt) {
    throw new HttpError(
      '未能解析登录页字段（execution / pwdEncryptSalt），统一认证页面可能已改版',
      'CAS_FORM_CHANGED',
    );
  }
  return {
    execution,
    salt,
    actionUrl: url,
    hasCaptcha: /name=["']captcha/i.test(html) || html.includes('验证码'),
  };
}

export interface CasLoginOptions {
  username: string;
  password: string;
  /** 登录后要建立的业务会话地址，默认网上办事大厅首页 */
  service?: string;
  trace?: TraceStep[];
}

export async function casLogin(options: CasLoginOptions): Promise<CasLoginResult> {
  const { username, password } = options;
  const trace: TraceStep[] = options.trace ?? [];
  const jar = new CookieJar();
  const service = options.service ?? `${config.ehall.portalBase}/`;
  const allowedHosts = [...config.ehall.allowedHosts];

  try {
    /* 1. 打开目标服务，拿到带 service 的 CAS 登录地址 */
    const entry = await requestWithJar({
      url: service,
      jar,
      allowedHosts,
      trace,
      headers: { Accept: 'text/html' },
    });

    if (!isLoginPage(entry.url, entry.text)) {
      return { ok: true, jar, steps: trace, finalUrl: entry.url };
    }

    /* 2. 解析登录表单 */
    const form = parseCasLoginForm(entry.text, entry.url);
    if (form.hasCaptcha) {
      return {
        ok: false,
        jar,
        steps: trace,
        error: {
          code: 'CAPTCHA_REQUIRED',
          message: '统一认证要求输入验证码',
          hint: '本项目不会尝试破解验证码。请在浏览器登录后，用「粘贴 Cookie」的方式导入会话。',
        },
      };
    }

    /* 3. 提交登录 */
    const body = new URLSearchParams({
      username,
      password: encryptCasPassword(password, form.salt),
      captcha: '',
      _eventId: 'submit',
      cllt: 'userNameLogin',
      dllt: 'generalLogin',
      lt: '',
      execution: form.execution,
    }).toString();

    const submitted = await requestWithJar({
      url: form.actionUrl,
      method: 'POST',
      body,
      jar,
      allowedHosts,
      trace,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Origin: config.ehall.casBase,
        Referer: form.actionUrl,
      },
    });

    if (isLoginPage(submitted.url, submitted.text)) {
      const message = /密码|错误|用户名|不存在|锁定/u.exec(submitted.text)
        ? '统一认证拒绝了这次登录（用户名或密码不正确，或账号被锁定）'
        : '统一认证未跳转，可能触发了安全策略';
      return {
        ok: false,
        jar,
        steps: trace,
        error: {
          code: 'CAS_LOGIN_REJECTED',
          message,
          hint: '若确认密码正确，可能是密码加密方式随学校升级发生变化，请查收服务端日志中的 trace。',
        },
      };
    }

    /* 4. 用 ticket 换取业务会话 */
    const ticket = new URL(service).searchParams.get('ticket') ?? '';
    if (ticket) trace.push({ url: `${service}?ticket=***`, status: 0, note: '已获得 ticket', elapsedMs: 0 });

    return { ok: true, jar, steps: trace, finalUrl: submitted.url };
  } catch (error) {
    if (error instanceof HttpError) {
      return {
        ok: false,
        jar,
        steps: trace,
        error: { code: error.code, message: error.message },
      };
    }
    return {
      ok: false,
      jar,
      steps: trace,
      error: {
        code: 'NETWORK_ERROR',
        message: error instanceof Error ? error.message : '网络请求失败',
        hint: '请确认当前网络能访问 authserver.nju.edu.cn（校外需先连 VPN）。',
      },
    };
  }
}

/** 用已导入的 Cookie 验证是否还能访问 ehall，并顺带补齐 ehallapp 的会话。 */
export async function warmUpEhallSession(jar: CookieJar): Promise<{ ok: boolean; steps: TraceStep[]; error?: string }> {
  const trace: TraceStep[] = [];
  try {
    const result = await requestWithJar({
      url: `https://ehallapp.nju.edu.cn/jwapp/sys/kcbcx/*default/index.do`,
      jar,
      allowedHosts: [...config.ehall.allowedHosts],
      trace,
    });
    if (isLoginPage(result.url, result.text)) {
      return { ok: false, steps: trace, error: '会话已失效，需要重新登录' };
    }
    return { ok: true, steps: trace };
  } catch (error) {
    return { ok: false, steps: trace, error: error instanceof Error ? error.message : '未知错误' };
  }
}
