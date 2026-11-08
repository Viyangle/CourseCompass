import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Plan, PlanComparison, PlanItem } from '@planner/shared';
import type { Store } from '../store/db.js';
import { AppError, ok, requireSession, sendError } from '../lib/http.js';
import { analyzePlan } from '../services/analysis.js';
import { exportPlanCsv, exportPlanIcs, exportPlanMarkdown } from '../services/export.js';

const createSchema = z.object({
  name: z.string().min(1).max(40),
  termId: z.string().optional(),
  copyFrom: z.string().optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).max(40).optional(),
  note: z.string().max(300).optional(),
  color: z.string().max(20).optional(),
});

const itemsSchema = z.object({
  items: z
    .array(
      z.object({
        sectionId: z.string().min(1),
        status: z.enum(['selected', 'backup']).default('selected'),
        note: z.string().max(200).optional(),
      }),
    )
    .max(40),
});

const PALETTE = ['#7c3aed', '#0f766e', '#b45309', '#be123c', '#1d4ed8'];

function findPlan(store: Store, id: string): Plan {
  const plan = store.data.plans.find((p) => p.id === id);
  if (!plan) throw new AppError('NOT_FOUND', '方案不存在', 404);
  return plan;
}

function newPlanId(): string {
  return `plan-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export async function registerPlanRoutes(app: FastifyInstance, store: Store): Promise<void> {
  app.get('/api/plans', async (request, reply) => {
    try {
      requireSession(request);
      const plans = store.data.plans.map((plan) => ({
        plan,
        analysis: analyzePlan(store.data, plan),
      }));
      return ok({ plans });
    } catch (error) {
      sendError(reply, error);
    }
  });

  app.post('/api/plans', async (request, reply) => {
    try {
      requireSession(request);
      const body = createSchema.parse(request.body ?? {});
      const db = store.data;
      const now = new Date().toISOString();
      const source = body.copyFrom ? db.plans.find((p) => p.id === body.copyFrom) : undefined;

      const plan: Plan = {
        id: newPlanId(),
        name: body.name,
        termId: body.termId ?? source?.termId ?? db.settings.planningTermId,
        items: source
          ? source.items.map((item, index) => ({
              ...item,
              id: `${Date.now().toString(36)}-${index}`,
              addedAt: now,
              origin: 'duplicate',
            }))
          : [],
        note: source?.note,
        color: PALETTE[db.plans.length % PALETTE.length],
        createdAt: now,
        updatedAt: now,
      };
      db.plans.push(plan);
      store.touch();
      return ok({ plan, analysis: analyzePlan(db, plan) });
    } catch (error) {
      if (error instanceof z.ZodError) {
        reply.status(400).send({ ok: false, error: { code: 'BAD_REQUEST', message: '方案名称不合法' } });
        return;
      }
      sendError(reply, error);
    }
  });

  app.patch('/api/plans/:id', async (request, reply) => {
    try {
      requireSession(request);
      const { id } = request.params as { id: string };
      const plan = findPlan(store, id);
      const body = updateSchema.parse(request.body ?? {});
      Object.assign(plan, body, { updatedAt: new Date().toISOString() });
      store.touch();
      return ok({ plan });
    } catch (error) {
      sendError(reply, error);
    }
  });

  app.delete('/api/plans/:id', async (request, reply) => {
    try {
      requireSession(request);
      const { id } = request.params as { id: string };
      findPlan(store, id);
      if (store.data.plans.length <= 1) {
        throw new AppError('LAST_PLAN', '至少保留一个方案', 409);
      }
      store.data.plans = store.data.plans.filter((p) => p.id !== id);
      store.touch();
      return ok({ deleted: id });
    } catch (error) {
      sendError(reply, error);
    }
  });

  app.post('/api/plans/:id/duplicate', async (request, reply) => {
    try {
      requireSession(request);
      const { id } = request.params as { id: string };
      const source = findPlan(store, id);
      const now = new Date().toISOString();
      const plan: Plan = {
        ...source,
        id: newPlanId(),
        name: `${source.name} 副本`,
        color: PALETTE[store.data.plans.length % PALETTE.length],
        items: source.items.map((item, index) => ({
          ...item,
          id: `${now}-${index}`,
          addedAt: now,
          origin: 'duplicate',
        })),
        createdAt: now,
        updatedAt: now,
      };
      store.data.plans.push(plan);
      store.touch();
      return ok({ plan, analysis: analyzePlan(store.data, plan) });
    } catch (error) {
      sendError(reply, error);
    }
  });

  /**
   * 整体替换方案项。
   * 选择"全量替换"而不是逐条增删，是为了让前端可以把一次拖拽/撤销合并成一次请求，
   * 也避免"局部更新"在并发下产生中间态。
   */
  app.put('/api/plans/:id/items', async (request, reply) => {
    try {
      requireSession(request);
      const { id } = request.params as { id: string };
      const plan = findPlan(store, id);
      const body = itemsSchema.parse(request.body ?? { items: [] });
      const db = store.data;
      const termSections = new Set(
        db.sections.filter((s) => s.termId === plan.termId).map((s) => s.id),
      );

      const seen = new Set<string>();
      const items: PlanItem[] = [];
      for (const [index, item] of body.items.entries()) {
        if (!termSections.has(item.sectionId)) {
          throw new AppError('SECTION_NOT_IN_TERM', '该教学班不属于当前学期', 400, { sectionId: item.sectionId });
        }
        if (seen.has(item.sectionId)) continue;
        seen.add(item.sectionId);
        const section = db.sections.find((s) => s.id === item.sectionId)!;
        items.push({
          id: `${plan.id}-item-${index}`,
          sectionId: item.sectionId,
          courseCode: section.courseCode,
          status: item.status,
          note: item.note,
          addedAt: new Date().toISOString(),
          origin: 'pool',
        });
      }

      plan.items = items;
      plan.updatedAt = new Date().toISOString();
      store.touch();
      return ok({ plan, analysis: analyzePlan(db, plan) });
    } catch (error) {
      if (error instanceof z.ZodError) {
        reply.status(400).send({ ok: false, error: { code: 'BAD_REQUEST', message: '课程项格式不正确' } });
        return;
      }
      sendError(reply, error);
    }
  });

  app.get('/api/plans/:id/analysis', async (request, reply) => {
    try {
      requireSession(request);
      const { id } = request.params as { id: string };
      const plan = findPlan(store, id);
      return ok(analyzePlan(store.data, plan));
    } catch (error) {
      sendError(reply, error);
    }
  });

  app.get('/api/compare', async (request, reply) => {
    try {
      requireSession(request);
      const raw = (request.query as { ids?: string }).ids ?? '';
      const ids = raw.split(',').map((id) => id.trim()).filter(Boolean);
      const plans = (ids.length > 0 ? ids.map((id) => findPlan(store, id)) : store.data.plans).slice(0, 4);
      if (plans.length === 0) throw new AppError('NO_PLAN', '没有可对比的方案', 400);

      const analyses = plans.map((plan) => analyzePlan(store.data, plan));
      const courseMap = new Map<string, PlanComparison['courses'][number]>();

      plans.forEach((plan, planIndex) => {
        const analysis = analyses[planIndex]!;
        const conflictByItem = new Map<string, number>();
        for (const issue of analysis.conflicts) {
          for (const itemId of issue.itemIds) {
            conflictByItem.set(itemId, (conflictByItem.get(itemId) ?? 0) + 1);
          }
        }
        for (const item of plan.items) {
          const section = store.data.sections.find((s) => s.id === item.sectionId);
          const course = store.data.courses.find((c) => c.code === item.courseCode);
          if (!course) continue;
          const entry =
            courseMap.get(course.code) ??
            ({
              courseCode: course.code,
              courseName: course.name,
              credits: course.credits,
              presence: Object.fromEntries(plans.map((p) => [p.id, 'none'])) as Record<string, 'selected' | 'backup' | 'none'>,
              conflictCount: Object.fromEntries(plans.map((p) => [p.id, 0])) as Record<string, number>,
            } satisfies PlanComparison['courses'][number]);
          entry.presence[plan.id] = item.status;
          entry.conflictCount[plan.id] = conflictByItem.get(item.id) ?? 0;
          courseMap.set(course.code, entry);
          void section;
        }
      });

      const comparison: PlanComparison = {
        plans: plans.map((plan, index) => ({
          id: plan.id,
          name: plan.name,
          color: plan.color,
          metrics: analyses[index]!.metrics,
          coverage: analyses[index]!.coverage,
        })),
        courses: [...courseMap.values()].sort((a, b) => a.courseCode.localeCompare(b.courseCode)),
      };
      return ok(comparison);
    } catch (error) {
      sendError(reply, error);
    }
  });

  app.get('/api/export/:planId', async (request, reply) => {
    try {
      requireSession(request);
      const { planId } = request.params as { planId: string };
      const plan = findPlan(store, planId);
      const format = (request.query as { format?: string }).format ?? 'md';
      const safeName = encodeURIComponent(`${plan.name}`);

      if (format === 'csv') {
        return reply
          .header('Content-Type', 'text/csv; charset=utf-8')
          .header('Content-Disposition', `attachment; filename*=UTF-8''${safeName}.csv`)
          .send(exportPlanCsv(store.data, plan));
      }
      if (format === 'ics') {
        return reply
          .header('Content-Type', 'text/calendar; charset=utf-8')
          .header('Content-Disposition', `attachment; filename*=UTF-8''${safeName}.ics`)
          .send(exportPlanIcs(store.data, plan));
      }
      return reply
        .header('Content-Type', 'text/markdown; charset=utf-8')
        .header('Content-Disposition', `attachment; filename*=UTF-8''${safeName}.md`)
        .send(exportPlanMarkdown(store.data, plan));
    } catch (error) {
      sendError(reply, error);
    }
  });
}
