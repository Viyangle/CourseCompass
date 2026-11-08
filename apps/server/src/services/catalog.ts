/**
 * 课程库检索。
 *
 * 这里做的不是"关键词过滤"，而是把**决策所需的信息**直接算进结果：
 * 这门课能补哪个缺口、和当前方案会不会撞、是不是已经修过、还有没有余量。
 * 因此课程列表本身就能回答"我要不要加它"，而不必点进详情再判断。
 */

import {
  buildCourseRequirementIndex,
  flattenRequirements,
  matchesRule,
  patternToMask,
  resolveCourseRequirementIds,
  type Course,
  type CourseQuery,
  type CourseQueryResult,
  type CourseWithSections,
  type Plan,
  type RequirementProgress,
  type Section,
} from '@planner/shared';
import type { Db } from '../store/types.js';
import { courseStates, programProgress } from './analysis.js';

function sectionConflicts(db: Db, plan: Plan, section: Section): boolean {
  const term = db.terms.find((t) => t.id === plan.termId);
  const weekCount = term?.weekCount ?? 20;
  void weekCount;
  for (const item of plan.items) {
    if (item.status !== 'selected') continue;
    const existing = db.sections.find((s) => s.id === item.sectionId);
    if (!existing) continue;
    for (const a of existing.meetings) {
      for (const b of section.meetings) {
        if (a.day !== b.day) continue;
        if (Math.max(a.startPeriod, b.startPeriod) > Math.min(a.endPeriod, b.endPeriod)) continue;
        if ((patternToMask(a.weeks) & patternToMask(b.weeks)) === 0) continue;
        return true;
      }
    }
  }
  return false;
}

export function queryCourses(db: Db, query: CourseQuery, activePlan?: Plan): CourseQueryResult {
  const termId = query.termId ?? db.settings.planningTermId;
  const progress = programProgress(db, activePlan);
  const states = courseStates(db, activePlan);

  /* 1. 本学期的教学班，按课程聚合 */
  const sectionsByCourse = new Map<string, Section[]>();
  for (const section of db.sections) {
    if (section.termId !== termId) continue;
    const list = sectionsByCourse.get(section.courseCode) ?? [];
    list.push(section);
    sectionsByCourse.set(section.courseCode, list);
  }

  /* 2. 仍未满足的模块 → 用于"补缺口"标记与筛选 */
  const gaps = new Map<string, string[]>();
  for (const { node } of flattenRequirements(db.program.modules)) {
    const leaf = findLeaf(progress.modules, node.id);
    if (!leaf || leaf.status === 'met') continue;
    gaps.set(node.id, []);
  }

  const requirementIndex = buildCourseRequirementIndex(db.program);
  const gapCourseCodes = new Set<string>();
  for (const course of db.courses) {
    if (!matchesAnyGap(course, db, gaps)) continue;
    if (states.passed.has(course.code)) continue;
    gapCourseCodes.add(course.code);
  }

  /* 3. 过滤 */
  const keyword = query.q?.trim().toLowerCase();
  const items: CourseWithSections[] = [];

  for (const course of db.courses) {
    const sections = sectionsByCourse.get(course.code) ?? [];
    const isPassed = states.passed.has(course.code);
    if (sections.length === 0 && !isPassed) continue;

    if (query.category && query.category !== 'all' && course.category !== query.category) continue;
    if (query.department && course.department !== query.department) continue;
    if (query.minCredits !== undefined && course.credits < query.minCredits) continue;
    if (query.maxCredits !== undefined && course.credits > query.maxCredits) continue;

    if (keyword) {
      const haystack = [
        course.name,
        course.code,
        course.department ?? '',
        ...sections.flatMap((section) => section.teachers),
      ]
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(keyword)) continue;
    }

    if (query.weekday !== undefined) {
      const hit = sections.some((section) => section.meetings.some((meeting) => meeting.day === query.weekday));
      if (!hit) continue;
    }

    if (query.onlyGaps && !gapCourseCodes.has(course.code)) continue;

    let conflict = false;
    if (query.noConflictWith && activePlan) {
      const usable = sections.some((section) => !sectionConflicts(db, activePlan, section));
      if (!usable) continue;
    } else {
      conflict = sections.length > 0 && sections.every((section) => activePlan && sectionConflicts(db, activePlan, section));
    }

    const state: CourseWithSections['state'] = states.inPlan.has(course.code)
      ? 'in-plan'
      : isPassed
        ? 'passed'
        : sections.some((section) => section.inCurrentTimetable)
          ? 'in-current-timetable'
          : conflict
            ? 'conflict'
            : 'available';

    items.push({
      course,
      sections,
      requirementIds: [...new Set([...(requirementIndex.get(course.code) ?? []), ...resolveCourseRequirementIds(db.program, course)])],
      state,
    });
  }

  /* 4. 排序：补缺口的优先，其次按名称 */
  const sort = query.sort ?? 'relevance';
  items.sort((a, b) => {
    if (sort === 'credits-asc') return a.course.credits - b.course.credits;
    if (sort === 'credits-desc') return b.course.credits - a.course.credits;
    if (sort === 'code') return a.course.code.localeCompare(b.course.code);
    const gapA = gapCourseCodes.has(a.course.code) ? 1 : 0;
    const gapB = gapCourseCodes.has(b.course.code) ? 1 : 0;
    if (gapA !== gapB) return gapB - gapA;
    return a.course.code.localeCompare(b.course.code);
  });

  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 20;
  const start = (page - 1) * pageSize;

  return {
    items: items.slice(start, start + pageSize),
    total: items.length,
    page,
    pageSize,
    gapCourseCodes: [...gapCourseCodes],
  };
}

function findLeaf(nodes: RequirementProgress[], nodeId: string): RequirementProgress | undefined {
  for (const node of nodes) {
    if (node.nodeId === nodeId) return node;
    if (node.children) {
      const found: RequirementProgress | undefined = findLeaf(node.children, nodeId);
      if (found) return found;
    }
  }
  return undefined;
}

function matchesAnyGap(course: Course, db: Db, gaps: Map<string, string[]>): boolean {
  for (const { node } of flattenRequirements(db.program.modules)) {
    if (!gaps.has(node.id) || !node.rule) continue;
    if (matchesRule(node.rule, { courseCode: course.code, tags: course.tags })) return true;
  }
  return false;
}
