/**
 * 冲突检测：系统的"确定性规则"核心。
 *
 * 产品上的取舍：
 * - 时间冲突是 **error**，因为它意味着物理上不可能同时上课；
 * - 已修、学分上限、校区通勤是 **warning**，学校允许但值得提醒；
 * - 未映射到培养方案是 **info**，只提示"可能不计入毕业要求"。
 *
 * 所有结论都给"人话解释 + 涉及课程 + 具体周次"，而不是一个红点。
 * 这是本项目相对教务系统最主要的体验差异。
 */

import type {
  ConflictIssue,
  Course,
  Meeting,
  Plan,
  Section,
  TermId,
  TranscriptRecord,
} from './types.js';
import { expandWeeks, formatWeeks, maskToWeeks, patternToMask } from './week.js';
import { formatDay } from './periods.js';

export interface AnalysisContext {
  sections: Section[];
  courses: Course[];
  transcript?: TranscriptRecord[];
  /** 学期教学周数 */
  weekCount: number;
  /** 规划目标学期 */
  termId: TermId;
  /** 课程号 → 覆盖的培养方案节点 id */
  requirementIdsByCourse?: Map<string, string[]>;
  /** 学期学分上限，默认 30 */
  creditCap?: number;
}

export interface ResolvedItem {
  itemId: string;
  section: Section;
  course: Course;
}

/** 把计划项解析成「计划项 + 教学班 + 课程」，忽略找不到的数据（数据漂移时不让整页崩掉）。 */
export function resolvePlanItems(plan: Plan, ctx: AnalysisContext): ResolvedItem[] {
  const sectionById = new Map(ctx.sections.map((s) => [s.id, s]));
  const courseById = new Map(ctx.courses.map((c) => [c.id, c]));
  const courseByCode = new Map(ctx.courses.map((c) => [c.code, c]));
  const out: ResolvedItem[] = [];
  for (const item of plan.items) {
    if (item.status !== 'selected') continue;
    const section = sectionById.get(item.sectionId);
    if (!section) continue;
    const course = courseById.get(section.courseId) ?? courseByCode.get(section.courseCode);
    if (!course) continue;
    out.push({ itemId: item.id, section, course });
  }
  return out;
}

function issueId(kind: string, ...parts: string[]): string {
  return `${kind}:${parts.slice().sort().join('|')}`;
}

interface MeetingSpan {
  day: number;
  startPeriod: number;
  endPeriod: number;
  weeks: number[];
}

function overlaps(a: Meeting, b: Meeting): { day: number; start: number; end: number; weeks: number[] } | null {
  if (a.day !== b.day) return null;
  const start = Math.max(a.startPeriod, b.startPeriod);
  const end = Math.min(a.endPeriod, b.endPeriod);
  if (start > end) return null;
  const mask = patternToMask(a.weeks) & patternToMask(b.weeks);
  if (mask === 0) return null;
  return { day: a.day, start, end, weeks: maskToWeeks(mask) };
}

function summarizeWeeks(weeks: number[]): string {
  if (weeks.length === 0) return '';
  if (weeks.length <= 6) return `${weeks.join('、')}周`;
  return `${formatWeeks(weeks)}（共 ${weeks.length} 周）`;
}

function describeSpan(span: MeetingSpan): string {
  const periods = span.startPeriod === span.endPeriod ? `${span.startPeriod}` : `${span.startPeriod}-${span.endPeriod}`;
  return `${formatDay(span.day)} 第 ${periods} 节`;
}

/**
 * 检测一个方案的全部问题。
 * 纯函数，前后端共用：前端用于即时反馈，后端用于持久化后的权威分析。
 */
export function detectConflicts(plan: Plan, ctx: AnalysisContext): ConflictIssue[] {
  const issues: ConflictIssue[] = [];
  const resolved = resolvePlanItems(plan, ctx);
  const passed = new Set((ctx.transcript ?? []).filter((r) => r.status === 'passed').map((r) => r.courseCode));
  const inProgress = new Set(
    (ctx.transcript ?? []).filter((r) => r.status === 'in-progress').map((r) => r.courseCode),
  );

  /* ---------- 1. 两两时间冲突 ---------- */
  for (let i = 0; i < resolved.length; i += 1) {
    for (let j = i + 1; j < resolved.length; j += 1) {
      const left = resolved[i]!;
      const right = resolved[j]!;
      const spans = new Map<string, MeetingSpan>();
      for (const a of left.section.meetings) {
        for (const b of right.section.meetings) {
          const hit = overlaps(a, b);
          if (!hit) continue;
          const key = `${hit.day}:${hit.start}-${hit.end}`;
          const exist = spans.get(key);
          if (exist) {
            exist.weeks = [...new Set([...exist.weeks, ...hit.weeks])].sort((x, y) => x - y);
          } else {
            spans.set(key, { day: hit.day, startPeriod: hit.start, endPeriod: hit.end, weeks: hit.weeks });
          }
        }
      }
      for (const span of spans.values()) {
        issues.push({
          id: issueId('time', left.itemId, right.itemId, String(span.day), `${span.startPeriod}`),
          kind: 'time',
          severity: 'error',
          message: `《${left.course.name}》与《${right.course.name}》在 ${describeSpan(span)} 冲突，重叠 ${summarizeWeeks(span.weeks)}。`,
          itemIds: [left.itemId, right.itemId],
          time: {
            day: span.day,
            startPeriod: span.startPeriod,
            endPeriod: span.endPeriod,
            weeks: span.weeks,
          },
        });
      }
    }
  }

  /* ---------- 2. 同一门课选了多个教学班 ---------- */
  const byCourse = new Map<string, ResolvedItem[]>();
  for (const item of resolved) {
    const list = byCourse.get(item.course.code) ?? [];
    list.push(item);
    byCourse.set(item.course.code, list);
  }
  for (const [code, items] of byCourse) {
    if (items.length < 2) continue;
    issues.push({
      id: issueId('duplicate-course', code),
      kind: 'duplicate-course',
      severity: 'warning',
      message: `《${items[0]!.course.name}》选了 ${items.length} 个教学班，学分只会计算一次。`,
      itemIds: items.map((i) => i.itemId),
    });
  }

  /* ---------- 3. 已修 / 在修课程重复选择 ---------- */
  for (const item of resolved) {
    if (!passed.has(item.course.code) && !inProgress.has(item.course.code)) continue;
    const isInProgress = !passed.has(item.course.code);
    // 本学期课表里的教学班本来就是「正在修」，把它当作重复选课来提醒只会制造噪音。
    if (isInProgress && item.section.inCurrentTimetable) continue;
    issues.push({
      id: issueId('already-passed', item.itemId),
      kind: 'already-passed',
      severity: 'warning',
      message: isInProgress
        ? `《${item.course.name}》正在修读（本学期课表里已有），重复选择通常不会额外计入学分。`
        : `《${item.course.name}》已经修读并通过，重复修读通常不再计入学分。`,
      itemIds: [item.itemId],
    });
  }

  /* ---------- 4. 学期学分上限 ---------- */
  const totalCredits = resolved.reduce((sum, item) => sum + item.course.credits, 0);
  const cap = ctx.creditCap ?? 30;
  if (totalCredits > cap) {
    issues.push({
      id: issueId('credit-cap', plan.id),
      kind: 'credit-cap',
      severity: 'warning',
      message: `本学期计划 ${totalCredits} 学分，超过 ${cap} 学分的学期上限。`,
      itemIds: resolved.map((i) => i.itemId),
    });
  }

  /* ---------- 5. 没有上课时间的教学班 ---------- */
  for (const item of resolved) {
    if (item.section.meetings.length > 0) continue;
    issues.push({
      id: issueId('no-meeting', item.itemId),
      kind: 'no-meeting',
      severity: 'info',
      message: `《${item.course.name}》该教学班没有排课时间，可能是线上课程或时间待定，无法判断冲突。`,
      itemIds: [item.itemId],
    });
  }

  /* ---------- 6. 上课周次超出学期范围 ---------- */
  for (const item of resolved) {
    const outOfRange = item.section.meetings.filter((m) => expandWeeks(m.weeks).some((w) => w > ctx.weekCount));
    if (outOfRange.length === 0) continue;
    issues.push({
      id: issueId('out-of-term', item.itemId),
      kind: 'out-of-term',
      severity: 'warning',
      message: `《${item.course.name}》有上课周次超出本学期 ${ctx.weekCount} 周的范围，可能属于其他学期或数据有误。`,
      itemIds: [item.itemId],
    });
  }

  /* ---------- 7. 校区通勤：连续两节之间换校区 ---------- */
  const byDay = new Map<number, { item: ResolvedItem; meeting: Meeting }[]>();
  for (const item of resolved) {
    for (const meeting of item.section.meetings) {
      const list = byDay.get(meeting.day) ?? [];
      list.push({ item, meeting });
      byDay.set(meeting.day, list);
    }
  }
  for (const [day, list] of byDay) {
    list.sort((a, b) => a.meeting.startPeriod - b.meeting.startPeriod);
    for (let i = 1; i < list.length; i += 1) {
      const prev = list[i - 1]!;
      const next = list[i]!;
      const prevCampus = prev.meeting.campus ?? prev.item.section.campus;
      const nextCampus = next.meeting.campus ?? next.item.section.campus;
      if (!prevCampus || !nextCampus || prevCampus === nextCampus) continue;
      if (next.meeting.startPeriod - prev.meeting.endPeriod !== 1) continue;
      issues.push({
        id: issueId('campus-gap', prev.item.itemId, next.item.itemId, String(day)),
        kind: 'campus-gap',
        severity: 'warning',
        message: `${formatDay(day)} 第 ${prev.meeting.endPeriod} 节在${prevCampus}，第 ${next.meeting.startPeriod} 节在${nextCampus}，两节课之间没有换校区的时间。`,
        itemIds: [prev.item.itemId, next.item.itemId],
      });
    }
  }

  /* ---------- 8. 未计入培养方案 ---------- */
  if (ctx.requirementIdsByCourse) {
    for (const item of resolved) {
      const nodes = ctx.requirementIdsByCourse.get(item.course.code);
      if (nodes && nodes.length > 0) continue;
      issues.push({
        id: issueId('requirement-unmapped', item.itemId),
        kind: 'requirement-unmapped',
        severity: 'info',
        message: `《${item.course.name}》没有匹配到培养方案中的任何模块，可能不会计入毕业学分。`,
        itemIds: [item.itemId],
      });
    }
  }

  return issues;
}

/** 找到某周某节上的所有计划项（课表渲染用）。 */
export function itemsAtCell(
  items: ResolvedItem[],
  day: number,
  period: number,
  week: number,
): ResolvedItem[] {
  return items.filter((item) =>
    item.section.meetings.some(
      (m) =>
        m.day === day &&
        m.startPeriod <= period &&
        m.endPeriod >= period &&
        patternToMask(m.weeks) & (1 << (week - 1)),
    ),
  );
}

/** 汇总某周的实际课时数，用于"这周累不累"提示。 */
export function weeklyPeriodsInWeek(items: ResolvedItem[], week: number): number {
  let total = 0;
  for (const item of items) {
    for (const m of item.section.meetings) {
      if (patternToMask(m.weeks) & (1 << (week - 1))) {
        total += m.endPeriod - m.startPeriod + 1;
      }
    }
  }
  return total;
}
