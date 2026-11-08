/**
 * 方案指标：回答"这套方案累不累"。
 *
 * 指标口径（界面上要写清楚，否则数字会误导）：
 * - 到校天数 / 空档节次：按"全学期并集"计算，即把它当成一个典型周来看；
 * - 每周平均课时：按有课的周次求平均；
 * - 最晚节次用于提示"晚上有课"这类真实负担。
 */

import type { Plan, PlanMetrics, Section, Course } from './types.js';
import { resolvePlanItems, type AnalysisContext } from './conflict.js';
import { maskToWeeks, patternToMask } from './week.js';

export interface MetricsContext {
  sections: Section[];
  courses: Course[];
  weekCount: number;
}

export function computePlanMetrics(plan: Plan, ctx: MetricsContext): PlanMetrics {
  const items = resolvePlanItems(plan, { ...ctx, weekCount: ctx.weekCount, termId: plan.termId });
  const backupSectionIds = new Set(plan.items.filter((i) => i.status === 'backup').map((i) => i.sectionId));
  const backupItemIds = new Set(plan.items.filter((i) => i.status === 'backup').map((i) => i.id));

  const selected = items;
  const totalCredits = selected.reduce((sum, item) => sum + item.course.credits, 0);
  const backupCredits = plan.items
    .filter((i) => i.status === 'backup')
    .reduce((sum, item) => {
      const section = ctx.sections.find((s) => s.id === item.sectionId);
      const course = section ? ctx.courses.find((c) => c.code === section.courseCode) : undefined;
      return sum + (course?.credits ?? 0);
    }, 0);

  const uniqueCourses = new Set(selected.map((item) => item.course.code));

  /** 每天被占用的节次集合（全学期并集） */
  const occupiedByDay = new Map<number, Set<number>>();
  /** 每一周的总课时 */
  const periodsByWeek = new Map<number, number>();

  for (const item of selected) {
    for (const meeting of item.section.meetings) {
      const set = occupiedByDay.get(meeting.day) ?? new Set<number>();
      for (let p = meeting.startPeriod; p <= meeting.endPeriod; p += 1) set.add(p);
      occupiedByDay.set(meeting.day, set);

      for (const week of maskToWeeks(patternToMask(meeting.weeks))) {
        periodsByWeek.set(week, (periodsByWeek.get(week) ?? 0) + (meeting.endPeriod - meeting.startPeriod + 1));
      }
    }
  }

  const activeDays = [...occupiedByDay.keys()].sort((a, b) => a - b);

  let earliestPeriod: number | null = null;
  let latestPeriod: number | null = null;
  const loadByDay: Record<number, number> = {};
  let gapPeriods = 0;

  for (const day of activeDays) {
    const periods = [...occupiedByDay.get(day)!].sort((a, b) => a - b);
    if (periods.length === 0) continue;
    const min = periods[0]!;
    const max = periods[periods.length - 1]!;
    loadByDay[day] = periods.length;
    gapPeriods += max - min + 1 - periods.length;
    earliestPeriod = earliestPeriod === null ? min : Math.min(earliestPeriod, min);
    latestPeriod = latestPeriod === null ? max : Math.max(latestPeriod, max);
  }

  const weeksWithClass = [...periodsByWeek.entries()].filter(([, count]) => count > 0);
  const weeklyPeriods =
    weeksWithClass.length === 0
      ? 0
      : Math.round((weeksWithClass.reduce((sum, [, count]) => sum + count, 0) / weeksWithClass.length) * 10) / 10;

  void backupSectionIds;
  void backupItemIds;

  return {
    totalCredits,
    backupCredits,
    courseCount: uniqueCourses.size,
    weeklyPeriods,
    activeDays,
    earliestPeriod,
    latestPeriod,
    gapPeriods,
    loadByDay,
    conflictCount: 0,
    warningCount: 0,
  };
}

/** 每周课时分布，用于方案对比时的柱状图。 */
export function weeklyLoadSeries(plan: Plan, ctx: MetricsContext): { week: number; periods: number }[] {
  const items = resolvePlanItems(plan, { ...ctx, weekCount: ctx.weekCount, termId: plan.termId });
  const series: { week: number; periods: number }[] = [];
  for (let week = 1; week <= ctx.weekCount; week += 1) {
    let periods = 0;
    for (const item of items) {
      for (const meeting of item.section.meetings) {
        if (patternToMask(meeting.weeks) & (1 << (week - 1))) {
          periods += meeting.endPeriod - meeting.startPeriod + 1;
        }
      }
    }
    series.push({ week, periods });
  }
  return series;
}

/** 把某周的上课情况摊平成格子，供课表组件直接渲染。 */
export interface GridBlock {
  itemId: string;
  sectionId: string;
  courseCode: string;
  courseName: string;
  teachers: string[];
  day: number;
  startPeriod: number;
  endPeriod: number;
  location?: string;
  campus?: string;
  weeksLabel: string;
  credits: number;
  colorKey: string;
}

export function buildWeekBlocks(plan: Plan, week: number, ctx: MetricsContext): GridBlock[] {
  const items = resolvePlanItems(plan, { ...ctx, weekCount: ctx.weekCount, termId: plan.termId });
  const blocks: GridBlock[] = [];
  for (const item of items) {
    for (const meeting of item.section.meetings) {
      if (!(patternToMask(meeting.weeks) & (1 << (week - 1)))) continue;
      blocks.push({
        itemId: item.itemId,
        sectionId: item.section.id,
        courseCode: item.course.code,
        courseName: item.course.name,
        teachers: item.section.teachers,
        day: meeting.day,
        startPeriod: meeting.startPeriod,
        endPeriod: meeting.endPeriod,
        location: meeting.location,
        campus: meeting.campus,
        weeksLabel: '',
        credits: item.course.credits,
        colorKey: item.course.category,
      });
    }
  }
  return blocks;
}

/** 一个方案在某周某格上是否有课——课表拖拽时的落点判定。 */
export function isCellOccupied(blocks: GridBlock[], day: number, period: number): boolean {
  return blocks.some((b) => b.day === day && b.startPeriod <= period && b.endPeriod >= period);
}

export type { AnalysisContext };
