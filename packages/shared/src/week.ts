/**
 * 教学周的位掩码工具。
 *
 * 为什么用位掩码：冲突判定本质是集合求交，`weekMask(a) & weekMask(b)` 一步完成；
 * 一周一格的课表渲染也只需要 `mask >>> 0 & (1 << (w - 1))`。
 * 位宽上限 31 周（JS 位运算 32 位有符号，最高位留空），足够覆盖任何本科教学周安排。
 */

import type { WeekPattern } from './types.js';

export const MAX_WEEKS = 31;

/** 把 WeekPattern 展开为具体周次数组（升序去重）。 */
export function expandWeeks(pattern: WeekPattern): number[] {
  if (pattern.explicit?.length) {
    return [...new Set(pattern.explicit)]
      .filter((w) => Number.isInteger(w) && w >= 1 && w <= MAX_WEEKS)
      .sort((a, b) => a - b);
  }
  const from = Math.max(1, Math.min(pattern.from, pattern.to));
  const to = Math.min(MAX_WEEKS, Math.max(pattern.from, pattern.to));
  const out: number[] = [];
  for (let week = from; week <= to; week += 1) {
    if (pattern.parity === 'odd' && week % 2 === 0) continue;
    if (pattern.parity === 'even' && week % 2 === 1) continue;
    out.push(week);
  }
  return out;
}

/** 周次数组 → 位掩码。 */
export function weeksToMask(weeks: number[]): number {
  let mask = 0;
  for (const week of weeks) {
    if (week >= 1 && week <= MAX_WEEKS) mask |= 1 << (week - 1);
  }
  return mask >>> 0;
}

export function patternToMask(pattern: WeekPattern): number {
  return weeksToMask(expandWeeks(pattern));
}

/** 位掩码 → 周次数组。 */
export function maskToWeeks(mask: number): number[] {
  const out: number[] = [];
  for (let week = 1; week <= MAX_WEEKS; week += 1) {
    if (mask & (1 << (week - 1))) out.push(week);
  }
  return out;
}

export function maskHasWeek(mask: number, week: number): boolean {
  return (mask & (1 << (week - 1))) !== 0;
}

/** 位掩码 → 紧凑文本，如 `1-8,10-16`。 */
export function formatWeeks(mask: number | number[]): string {
  const weeks = Array.isArray(mask) ? [...mask].sort((a, b) => a - b) : maskToWeeks(mask);
  if (weeks.length === 0) return '—';
  const ranges: string[] = [];
  let start = weeks[0]!;
  let prev = start;
  for (let i = 1; i <= weeks.length; i += 1) {
    const current = weeks[i];
    if (current === prev + 1) {
      prev = current;
      continue;
    }
    ranges.push(start === prev ? `${start}` : `${start}-${prev}`);
    if (current === undefined) break;
    start = current;
    prev = current;
  }
  return `${ranges.join(',')}周`;
}

/** WeekPattern → 文本，能识别"单周/双周"并显式说明。 */
export function formatWeekPattern(pattern: WeekPattern): string {
  const weeks = expandWeeks(pattern);
  if (weeks.length === 0) return '—';

  // 未显式列出周次时，按"名义区间"展示：1-16 周单周 → 「1-16周（单周）」，
  // 而不是「1-15周」，后者会让用户以为课程只上到 15 周。
  const explicit = (pattern.explicit?.length ?? 0) > 0;
  const from = explicit ? weeks[0]! : Math.max(1, Math.min(pattern.from, pattern.to));
  const to = explicit ? weeks[weeks.length - 1]! : Math.min(MAX_WEEKS, Math.max(pattern.from, pattern.to));
  const span = to - from + 1;
  const suffix = pattern.parity === 'odd' ? '（单周）' : pattern.parity === 'even' ? '（双周）' : '';
  const expected = pattern.parity === 'all' ? span : Math.ceil(span / 2);
  if (weeks.length === expected) return `${from}-${to}周${suffix}`;
  return `${formatWeeks(weeks)}${suffix}`;
}

/** 两个周集合是否有交集。 */
export function weeksIntersect(a: number, b: number): boolean {
  return (a & b) !== 0;
}

/** 判断某周是否位于学期范围内。 */
export function isWeekInTerm(week: number, weekCount: number): boolean {
  return week >= 1 && week <= weekCount;
}

/** 根据学期起始日与当前日期，推算当前是第几教学周（1 起）。 */
export function weekOfDate(startDate: string, date: Date = new Date()): number {
  const start = new Date(`${startDate}T00:00:00+08:00`);
  if (Number.isNaN(start.getTime())) return 1;
  const diffDays = Math.floor((date.getTime() - start.getTime()) / 86_400_000);
  if (diffDays < 0) return 1;
  return Math.floor(diffDays / 7) + 1;
}
