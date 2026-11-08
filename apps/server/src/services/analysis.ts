/**
 * 分析服务：把"数据库里的原始记录"翻译成前端需要的三种结论。
 *
 *   analyzePlan   → 冲突 + 指标 + 覆盖度（规划工作台右侧 / 方案卡片）
 *   programProgress → 培养方案进度（概览 / 培养方案页 / 对比页）
 *
 * 所有计算都调用 @planner/shared 里的纯函数，保证前端本地预览与后端结果一致。
 */

import {
  buildRequirementIndex,
  collectPlannedCourses,
  computePlanMetrics,
  computeProgramProgress,
  detectConflicts,
  resolvePlanItems,
  sortIssues,
  type AnalysisContext,
  type ConflictIssue,
  type Plan,
  type PlanAnalysis,
  type ProgramProgress,
} from '@planner/shared';
import type { Db } from '../store/types.js';
import { config } from '../config.js';

export function buildContext(db: Db, plan: Plan): AnalysisContext {
  const term = db.terms.find((t) => t.id === plan.termId);
  return {
    sections: db.sections,
    courses: db.courses,
    transcript: db.transcript,
    weekCount: term?.weekCount ?? 20,
    termId: plan.termId,
    requirementIdsByCourse: buildRequirementIndex(db.program, db.courses),
    creditCap: db.settings.creditCap || config.creditCap,
  };
}

/** 计划中（含在修）的课程，用于培养方案核算。 */
export function plannedCourses(db: Db, plan?: Plan) {
  return collectPlannedCourses({
    transcript: db.transcript,
    plan,
    sections: db.sections,
    courses: db.courses,
  });
}

export function programProgress(db: Db, plan?: Plan): ProgramProgress {
  return computeProgramProgress({
    program: db.program,
    transcript: db.transcript,
    planned: plannedCourses(db, plan),
    courses: db.courses,
  });
}

export function analyzePlan(db: Db, plan: Plan): PlanAnalysis {
  const ctx = buildContext(db, plan);
  const conflicts = sortIssues(detectConflicts(plan, ctx));
  const metrics = computePlanMetrics(plan, ctx);
  metrics.conflictCount = conflicts.filter((issue) => issue.severity === 'error').length;
  metrics.warningCount = conflicts.filter((issue) => issue.severity !== 'error').length;

  const progress = programProgress(db, plan);
  return { metrics, conflicts, coverage: progress.modules };
}

/** 某个课程在计划中是否已选中（用于课程卡片状态）。 */
export function courseStates(db: Db, plan?: Plan) {
  const inPlan = new Set<string>();
  for (const item of plan?.items ?? []) inPlan.add(item.courseCode);
  const passed = new Set(db.transcript.filter((r) => r.status === 'passed').map((r) => r.courseCode));
  const inProgress = new Set(db.transcript.filter((r) => r.status === 'in-progress').map((r) => r.courseCode));
  return { inPlan, passed, inProgress };
}

/** 单个教学班与现有计划的冲突（课程库筛选"不冲突"时用）。 */
export function sectionConflictsWithPlan(db: Db, plan: Plan, sectionId: string): ConflictIssue[] {
  const context = buildContext(db, plan);
  const section = db.sections.find((s) => s.id === sectionId);
  if (!section) return [];

  const items = resolvePlanItems(plan, context);
  const issues: ConflictIssue[] = [];
  for (const existing of items) {
    for (const a of existing.section.meetings) {
      for (const b of section.meetings) {
        if (a.day !== b.day) continue;
        if (Math.max(a.startPeriod, b.startPeriod) > Math.min(a.endPeriod, b.endPeriod)) continue;
        issues.push({
          id: `preview:${existing.section.id}:${section.id}`,
          kind: 'time',
          severity: 'error',
          message: `与《${existing.course.name}》在周${a.day} 第${Math.max(a.startPeriod, b.startPeriod)}-${Math.min(a.endPeriod, b.endPeriod)}节时间重叠`,
          itemIds: [existing.itemId],
        });
      }
    }
  }
  return issues;
}
