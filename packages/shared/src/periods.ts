import type { PeriodConfig } from './types.js';

/**
 * 默认作息表（仙林/鼓楼常用版），仅作为初始值。
 * 实际项目里必须可在「设置 → 作息」中修改，因为学校会调整作息，
 * 而作息一旦错了，所有"最早/最晚/空档"指标都会跟着错。
 */
export const DEFAULT_PERIODS: PeriodConfig[] = [
  { period: 1, start: '08:00', end: '08:50' },
  { period: 2, start: '09:00', end: '09:50' },
  { period: 3, start: '10:10', end: '11:00' },
  { period: 4, start: '11:10', end: '12:00' },
  { period: 5, start: '14:00', end: '14:50' },
  { period: 6, start: '15:00', end: '15:50' },
  { period: 7, start: '16:10', end: '17:00' },
  { period: 8, start: '17:10', end: '18:00' },
  { period: 9, start: '18:30', end: '19:20' },
  { period: 10, start: '19:30', end: '20:20' },
  { period: 11, start: '20:30', end: '21:20' },
  { period: 12, start: '21:30', end: '22:20' },
];

export const WEEKDAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'] as const;

export const WEEKDAY_SHORT = ['一', '二', '三', '四', '五', '六', '日'] as const;

export function periodLabel(period: number): string {
  const config = DEFAULT_PERIODS.find((p) => p.period === period);
  return config ? `${config.start}-${config.end}` : `第${period}节`;
}

/** 若干节次 → 简洁时间文本，如「10:10-12:00（3-4节）」。 */
export function formatPeriodRange(start: number, end: number, periods = DEFAULT_PERIODS): string {
  const first = periods.find((p) => p.period === start);
  const last = periods.find((p) => p.period === end);
  if (!first || !last) return `第${start}-${end}节`;
  return `${first.start}-${last.end}（${start === end ? `${start}` : `${start}-${end}`}节）`;
}

/** 上午/下午/晚上，用于筛选与视觉分组。 */
export function periodBucket(period: number): 'morning' | 'afternoon' | 'evening' {
  if (period <= 4) return 'morning';
  if (period <= 8) return 'afternoon';
  return 'evening';
}

export function formatDay(day: number): string {
  return WEEKDAY_LABELS[day - 1] ?? `第${day}天`;
}
