/**
 * ehall 业务接口客户端。
 *
 * 金智 ehall 的接口形态（所有 app 共用）：
 *   POST https://ehallapp.nju.edu.cn/jwapp/sys/{appId}/modules/{module}/{method}.do
 *   Content-Type: application/x-www-form-urlencoded
 *   Body: param=<json>&pageSize=100&pageNumber=1
 *   返回: { code: '0' | 0, datas: { rows: [...] } } 或 { data: { ... } }
 *
 * 但各模块的参数结构差异很大，且不同学校版本不同，所以这里做两件事：
 * 1. 只负责"把请求发出去、把响应拿回来"，不做业务假设；
 * 2. 提供容错的响应解析（extractRows），让上层映射代码不必为每个版本写一份。
 */

import type { CookieJar } from './cookies.js';
import { HttpError, requestWithJar, type TraceStep } from './http.js';
import { config } from '../../config.js';

export interface EhallCallOptions {
  jar: CookieJar;
  appId: string;
  module: string;
  method: string;
  /** 直接给出的表单体；与 paramJson 二选一 */
  form?: Record<string, string>;
  /** 会自动序列化到 param 字段 */
  paramJson?: unknown;
  trace?: TraceStep[];
}

export interface EhallCallResult {
  ok: boolean;
  status: number;
  url: string;
  json?: unknown;
  text?: string;
  /** 是否被重定向回登录页（会话失效） */
  needsLogin: boolean;
  error?: string;
}

export async function callJwapp(options: EhallCallOptions): Promise<EhallCallResult> {
  const { jar, appId, module, method } = options;
  const url = `${config.ehall.appBase}/jwapp/sys/${appId}/modules/${module}/${method}.do`;
  const form = new URLSearchParams(options.form ?? {});
  if (options.paramJson !== undefined) form.set('param', JSON.stringify(options.paramJson));
  if (!form.has('pageSize')) form.set('pageSize', '200');
  if (!form.has('pageNumber')) form.set('pageNumber', '1');

  try {
    const result = await requestWithJar({
      url,
      method: 'POST',
      body: form.toString(),
      jar,
      allowedHosts: [...config.ehall.allowedHosts],
      trace: options.trace,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
        Accept: 'application/json, text/javascript, */*; q=0.01',
      },
    });

    const needsLogin = result.url.includes('authserver.nju.edu.cn') || result.text.includes('统一身份认证');
    if (needsLogin) {
      return { ok: false, status: result.status, url: result.url, needsLogin: true, text: result.text.slice(0, 500), error: '会话已失效' };
    }

    try {
      return { ok: true, status: result.status, url, json: JSON.parse(result.text), needsLogin: false };
    } catch {
      return {
        ok: result.status === 200,
        status: result.status,
        url,
        text: result.text.slice(0, 2000),
        needsLogin: false,
        error: '响应不是 JSON，可能接口名不对或返回了错误页',
      };
    }
  } catch (error) {
    if (error instanceof HttpError) {
      return { ok: false, status: error.status, url, needsLogin: false, error: `${error.code}: ${error.message}` };
    }
    return { ok: false, status: 0, url, needsLogin: false, error: error instanceof Error ? error.message : '网络错误' };
  }
}

/**
 * 从任意 ehall 响应里挖出"行数组"。
 * 各应用返回结构不同（datas.rows / data.list / 顶层数组 / 以数字为键的对象），
 * 这里做启发式提取，宁可多找一层，也不要因为结构差异让整块功能失效。
 */
export function extractRows(json: unknown, depth = 0): Record<string, unknown>[] {
  if (depth > 4 || json === null || json === undefined) return [];
  if (Array.isArray(json)) {
    return json.filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null);
  }
  if (typeof json !== 'object') return [];
  const record = json as Record<string, unknown>;

  const preferred = ['rows', 'list', 'items', 'records', 'datas', 'data', 'result', 'results'];
  for (const key of preferred) {
    if (key in record) {
      const rows = extractRows(record[key], depth + 1);
      if (rows.length > 0) return rows;
    }
  }
  for (const value of Object.values(record)) {
    if (Array.isArray(value)) {
      const rows = extractRows(value, depth + 1);
      if (rows.length > 0) return rows;
    }
  }
  // 以数字为键的对象（金智的 Map 序列化）
  const numericKeys = Object.keys(record).filter((key) => /^\d+$/.test(key));
  if (numericKeys.length > 0) {
    return numericKeys.map((key) => record[key]).filter((v): v is Record<string, unknown> => typeof v === 'object' && v !== null);
  }
  return [];
}

/** 从响应里取字符串字段，兼容 code 为 "0" / 0 / "success" 的情况。 */
export function isSuccessCode(json: unknown): boolean {
  if (typeof json !== 'object' || json === null) return false;
  const record = json as Record<string, unknown>;
  const code = record.code ?? record.returnCode ?? record.status;
  return code === 0 || code === '0' || code === 'success' || code === 'SUCCESS';
}
