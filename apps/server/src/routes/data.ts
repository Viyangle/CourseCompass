import type { FastifyInstance } from 'fastify';
import type { BootstrapData, CourseQuery, SessionInfo } from '@planner/shared';
import type { Store } from '../store/db.js';
import { AppError, ok, requireSession, sendError } from '../lib/http.js';
import { programProgress, analyzePlan } from '../services/analysis.js';
import { queryCourses } from '../services/catalog.js';
import { fetchNjuBundle, mapBundleToDb } from '../import/nju.js';
import { sessions } from '../services/session.js';
import { config } from '../config.js';

function catalogVersion(store: Store): string {
  const { courses, sections } = store.data;
  return `${courses.length}-${sections.length}-${store.data.program.id}`;
}

export async function registerDataRoutes(app: FastifyInstance, store: Store): Promise<void> {
  app.get('/api/bootstrap', async (request, reply) => {
    try {
      const session = requireSession(request);
      const db = store.data;
      const sessionInfo: SessionInfo = {
        authenticated: true,
        method: session.method,
        profile: session.profile ?? db.profile,
        expiresIn: config.sessionTtl,
        offline: config.demoMode || session.method === 'demo',
      };
      const payload: BootstrapData = {
        session: sessionInfo,
        terms: db.terms,
        currentTermId: db.settings.currentTermId,
        planningTermId: db.settings.planningTermId,
        periods: db.periods,
        profile: sessionInfo.profile ?? db.profile,
        program: db.program,
        transcript: db.transcript,
        warnings: db.warnings,
        plans: db.plans,
        sources: db.sources,
        catalogVersion: catalogVersion(store),
      };
      return ok(payload);
    } catch (error) {
      sendError(reply, error);
    }
  });

  app.get('/api/program', async (request, reply) => {
    try {
      requireSession(request);
      const planId = (request.query as { planId?: string }).planId;
      const plan = planId ? store.data.plans.find((p) => p.id === planId) : undefined;
      return ok({
        program: store.data.program,
        progress: programProgress(store.data, plan),
        policy: store.data.settings.allocationPolicy,
      });
    } catch (error) {
      sendError(reply, error);
    }
  });

  app.get('/api/transcript', async (request, reply) => {
    try {
      requireSession(request);
      const records = [...store.data.transcript].sort((a, b) => {
        if (a.termId !== b.termId) return a.termId < b.termId ? 1 : -1;
        return a.courseCode.localeCompare(b.courseCode);
      });
      return ok({ records, warnings: store.data.warnings });
    } catch (error) {
      sendError(reply, error);
    }
  });

  /** 一次性把某个学期的课程库与教学班发给前端，让筛选/拖拽全部在本地完成。 */
  app.get('/api/catalog', async (request, reply) => {
    try {
      requireSession(request);
      const db = store.data;
      const termId = (request.query as { termId?: string }).termId ?? db.settings.planningTermId;
      const sections = db.sections.filter((s) => s.termId === termId);
      const offered = new Set(sections.map((s) => s.courseCode));
      const courses = db.courses.filter((c) => offered.has(c.code) || db.transcript.some((r) => r.courseCode === c.code));
      return ok({
        termId,
        courses,
        sections,
        // 只返回学生课表里的教学班；否则真实数据下会把整个课程库（3000+）当成"本周课表"。
        currentTermSections: db.sections.filter(
          (section) => section.termId === db.settings.currentTermId && section.inCurrentTimetable,
        ),
      });
    } catch (error) {
      sendError(reply, error);
    }
  });

  app.get('/api/courses', async (request, reply) => {
    try {
      requireSession(request);
      const raw = request.query as Record<string, string | undefined>;
      const activePlanId = raw.noConflictWith ?? raw.activePlanId;
      const plan = activePlanId ? store.data.plans.find((p) => p.id === activePlanId) : undefined;
      const query: CourseQuery = {
        termId: raw.termId,
        q: raw.q,
        category: (raw.category as CourseQuery['category']) ?? undefined,
        department: raw.department,
        minCredits: raw.minCredits ? Number(raw.minCredits) : undefined,
        maxCredits: raw.maxCredits ? Number(raw.maxCredits) : undefined,
        weekday: raw.weekday ? Number(raw.weekday) : undefined,
        noConflictWith: raw.noConflictWith,
        onlyGaps: raw.onlyGaps === '1' || raw.onlyGaps === 'true',
        page: raw.page ? Number(raw.page) : 1,
        pageSize: raw.pageSize ? Number(raw.pageSize) : 20,
        sort: (raw.sort as CourseQuery['sort']) ?? 'relevance',
      };
      return ok(queryCourses(store.data, query, plan));
    } catch (error) {
      sendError(reply, error);
    }
  });

  app.get('/api/courses/:code', async (request, reply) => {
    try {
      requireSession(request);
      const { code } = request.params as { code: string };
      const db = store.data;
      const course = db.courses.find((c) => c.code === code);
      if (!course) throw new AppError('NOT_FOUND', `没有找到课程 ${code}`, 404);
      const sections = db.sections.filter((s) => s.courseCode === code && s.termId === db.settings.planningTermId);
      const record = db.transcript.find((r) => r.courseCode === code);
      return ok({ course, sections, transcript: record ?? null });
    } catch (error) {
      sendError(reply, error);
    }
  });

  app.get('/api/sources', async (request, reply) => {
    try {
      requireSession(request);
      return ok({ sources: store.data.sources, snapshots: store.data.rawSnapshots.slice(0, 10) });
    } catch (error) {
      sendError(reply, error);
    }
  });

  /**
   * 同步入口。
   * 演示模式下只刷新时间戳；真实模式下若接口尚未确认，明确告诉用户下一步该做什么，
   * 而不是假装同步成功——这条边界是产品可信度的一部分。
   */
  app.post('/api/sync', async (request, reply) => {
    try {
      const session = requireSession(request);
      const body = (request.body ?? {}) as { sources?: string[]; termId?: string };
      const kinds = body.sources?.length ? body.sources : store.data.sources.map((s) => s.kind);

      if (session.method === 'demo') {
        const now = new Date().toISOString();
        for (const source of store.data.sources) {
          if (!kinds.includes(source.kind)) continue;
          source.fetchedAt = now;
          source.status = 'ok';
        }
        store.touch();
        return ok({ synced: kinds, mode: 'mock', message: '本地模式：已刷新数据时间戳，未访问 ehall。' });
      }

      // 真实同步：用登录会话的 Cookie 抓取五类数据，再整体重建本地库。
      const jar = sessions.getJar(session);
      if (!jar) throw new AppError('NO_EHALL_SESSION', '当前会话没有 ehall Cookie，请重新登录', 409);
      const cookieHeader = jar.header(new URL('https://ehallapp.nju.edu.cn/'));
      if (!cookieHeader) throw new AppError('NO_EHALL_SESSION', '会话中没有可用的 ehall Cookie', 409);

      const bundle = await fetchNjuBundle(cookieHeader, body.termId);
      if (bundle.transcript.length === 0 && bundle.catalog.length === 0) {
        throw new AppError('EHALL_SESSION_EXPIRED', 'ehall 会话已失效，请重新登录后再同步', 401, {
          trace: bundle.errors,
        });
      }

      const next = mapBundleToDb(bundle);
      const validSections = new Set(next.sections.map((section) => section.id));
      const keptPlans = store.data.plans
        .filter((plan) => plan.id !== 'plan-real')
        .map((plan) => ({ ...plan, items: plan.items.filter((item) => validSections.has(item.sectionId)) }));
      next.plans = [...keptPlans, ...next.plans];

      store.replace(next);

      return ok({
        synced: kinds,
        mode: 'ehall',
        message: `已同步：${next.transcript.length} 条成绩 · ${next.sections.length} 个教学班 · ${bundle.timetable.length} 门在修`,
        summary: {
          transcript: next.transcript.length,
          sections: next.sections.length,
          courses: next.courses.length,
          timetable: bundle.timetable.length,
          currentTerm: next.settings.currentTermId,
          planningTerm: next.settings.planningTermId,
          warnings: bundle.errors,
        },
      });
    } catch (error) {
      sendError(reply, error);
    }
  });

  /** 方案列表的分析摘要，供概览页并行展示 */
  app.get('/api/analysis/:planId', async (request, reply) => {
    try {
      requireSession(request);
      const { planId } = request.params as { planId: string };
      const plan = store.data.plans.find((p) => p.id === planId);
      if (!plan) throw new AppError('NOT_FOUND', '方案不存在', 404);
      return ok(analyzePlan(store.data, plan));
    } catch (error) {
      sendError(reply, error);
    }
  });
}
