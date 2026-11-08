import {
  buildRequirementIndex,
  collectPlannedCourses,
  computePlanMetrics,
  computeProgramProgress,
  detectConflicts,
  sortIssues,
  type ConflictIssue,
  type Course,
  type Plan,
  type PlanAnalysis,
  type ProgramProgress,
  type ProgramVersion,
  type Section,
  type TranscriptRecord,
} from '@planner/shared';

export interface AnalysisDeps {
  program: ProgramVersion | null;
  transcript: TranscriptRecord[];
  courses: Course[];
  sections: Section[];
  weekCount: number;
  creditCap?: number;
}

/** 前端本地的完整分析：冲突 + 指标 + 培养方案覆盖。 */
export function analyzePlanLocal(plan: Plan, deps: AnalysisDeps): PlanAnalysis | null {
  if (!deps.program) return null;
  const context = {
    sections: deps.sections,
    courses: deps.courses,
    transcript: deps.transcript,
    weekCount: deps.weekCount,
    termId: plan.termId,
    requirementIdsByCourse: buildRequirementIndex(deps.program, deps.courses),
    creditCap: deps.creditCap ?? 30,
  };

  const conflicts: ConflictIssue[] = sortIssues(detectConflicts(plan, context));
  const metrics = computePlanMetrics(plan, context);
  metrics.conflictCount = conflicts.filter((issue) => issue.severity === 'error').length;
  metrics.warningCount = conflicts.length - metrics.conflictCount;

  const planned = collectPlannedCourses({
    transcript: deps.transcript,
    plan,
    sections: deps.sections,
    courses: deps.courses,
  });
  const progress = computeProgramProgress({
    program: deps.program,
    transcript: deps.transcript,
    planned,
    courses: deps.courses,
  });

  return { metrics, conflicts, coverage: progress.modules };
}

export function progressLocal(plan: Plan | undefined, deps: AnalysisDeps): ProgramProgress | null {
  if (!deps.program) return null;
  const planned = collectPlannedCourses({
    transcript: deps.transcript,
    plan,
    sections: deps.sections,
    courses: deps.courses,
  });
  return computeProgramProgress({ program: deps.program, transcript: deps.transcript, planned, courses: deps.courses });
}
