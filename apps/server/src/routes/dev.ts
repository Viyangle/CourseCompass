/**
 * 开发探针：只在 DEV_TOOLS=1 时挂载。
 *
 * 用途很具体：ehall 的接口名没法靠猜，必须用真实会话试一次。
 * 这个路由把"试"这件事做成按钮：
 *   - 按 app → 依次尝试候选 module/method，返回状态码、行数、字段名；
 *   - 成功的响应自动存成原始快照（data/raw/*.json），后续映射可以离线调试；
 *   - 也支持直接重放浏览器复制的请求（url + headers + body）。
 *
 * 它不会绕过任何权限：只使用调用者自己的会话。
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Store } from '../store/db.js';
import { AppError, ok, requireSession, sendError } from '../lib/http.js';
import { sessions } from '../services/session.js';
import { callJwapp, extractRows } from '../adapters/ehall/client.js';
import { requestWithJar } from '../adapters/ehall/http.js';
import { config } from '../config.js';

const probeSchema = z.object({
  appId: z.string().min(1),
  module: z.string().min(1),
  method: z.string().min(1),
  form: z.record(z.string()).optional(),
});

const captureSchema = z.object({
  url: z.string().url(),
  method: z.enum(['GET', 'POST']).default('POST'),
  headers: z.record(z.string()).optional(),
  body: z.string().optional(),
  kind: z.string().default('unknown'),
});

export async function registerDevRoutes(app: FastifyInstance, store: Store): Promise<void> {
  app.post('/api/dev/probe', async (request, reply) => {
    try {
      if (!config.devTools) throw new AppError('DISABLED', '开发工具未开启', 403);
      const session = requireSession(request);
      const jar = sessions.getJar(session);
      if (!jar) throw new AppError('NO_EHALL_SESSION', '当前会话没有 ehall Cookie，请先用真实身份登录或导入 Cookie', 409);

      const body = probeSchema.parse(request.body);
      const result = await callJwapp({
        jar,
        appId: body.appId,
        module: body.module,
        method: body.method,
        form: body.form,
      });

      let rows: Record<string, unknown>[] = [];
      let sampleKeys: string[] = [];
      if (result.json) {
        rows = extractRows(result.json);
        sampleKeys = rows[0] ? Object.keys(rows[0]).slice(0, 40) : [];
        if (rows.length > 0) {
          await store.saveRaw(body.appId, result.json, { url: result.url });
        }
      }

      return ok({
        ok: result.ok,
        status: result.status,
        needsLogin: result.needsLogin,
        rowCount: rows.length,
        sampleKeys,
        error: result.error,
        url: result.url,
      });
    } catch (error) {
      sendError(reply, error);
    }
  });

  app.post('/api/dev/capture', async (request, reply) => {
    try {
      if (!config.devTools) throw new AppError('DISABLED', '开发工具未开启', 403);
      const session = requireSession(request);
      const jar = sessions.getJar(session);
      if (!jar) throw new AppError('NO_EHALL_SESSION', '当前会话没有 ehall Cookie', 409);

      const body = captureSchema.parse(request.body);
      const result = await requestWithJar({
        url: body.url,
        method: body.method,
        body: body.body,
        headers: body.headers,
        jar,
        allowedHosts: [...config.ehall.allowedHosts],
      });

      let json: unknown = null;
      try {
        json = JSON.parse(result.text);
      } catch {
        json = null;
      }
      const rows = json ? extractRows(json) : [];
      const file = await store.saveRaw(body.kind, json ?? { text: result.text.slice(0, 5000) }, { url: body.url });

      return ok({
        status: result.status,
        savedTo: file,
        rowCount: rows.length,
        sampleKeys: rows[0] ? Object.keys(rows[0]).slice(0, 40) : [],
        preview: json === null ? result.text.slice(0, 500) : undefined,
      });
    } catch (error) {
      sendError(reply, error);
    }
  });

  app.get('/api/dev/snapshots', async (request, reply) => {
    try {
      requireSession(request);
      return ok({ snapshots: store.data.rawSnapshots });
    } catch (error) {
      sendError(reply, error);
    }
  });
}
