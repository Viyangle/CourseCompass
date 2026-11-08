/**
 * 原始数据 → 领域模型的映射层。
 *
 * 这一层存在的理由：ehall 的字段名随应用/学期/学校版本变化（同一个"课程名称"可能是
 * kcmc、KCMC、kcName），时间信息更是常被塞进 "周一第3,4节{第1-16周|单周}" 这样的字符串。
 * 把解析逻辑集中在这里，换学期只需要改映射，不必动业务代码。
 *
 * 原则：**能解析多少解析多少，解析不了的保留原文并标记 ambiguous**，
 * 绝不因为一个字段缺失就丢掉整门课——用户宁可看到"周次待确认"，也不愿看到课程消失。
 */

import type { Course, CourseCategory, Meeting, WeekParity, WeekPattern } from '@planner/shared';

const FIELD_ALIASES: Record<string, string[]> = {
  courseCode: ['kcdm', 'KCDM', 'courseCode', 'course_code', 'kch', 'kcdm_display', 'kch_id'],
  courseName: ['kcmc', 'KCMC', 'courseName', 'course_name', 'kcname'],
  credits: ['xf', 'XF', 'credits', 'credit', 'xf_display'],
  hours: ['zxs', 'ZXS', 'hours', 'xs'],
  department: ['kkxy', 'KKXY', 'department', 'yxmc', 'kkbm'],
  category: ['kcxz', 'KCXZ', 'kcxz_display', 'courseType', 'kclb'],
  assessment: ['khfs', 'KHFS', 'assessment', 'khfs_display'],
  teacher: ['jsxm', 'JSXM', 'teacher', 'skjs', 'jsmc'],
  location: ['jxdd', 'JXDD', 'location', 'skdd', 'cdmc'],
  day: ['xqj', 'XQJ', 'day', 'xingqi', 'weekday'],
  periods: ['jc', 'JC', 'jcs', 'jcs_display', 'periods', 'jieci'],
  weeks: ['zcd', 'ZCD', 'weeks', 'zhouci', 'zcd_display'],
  classNo: ['jxbmc', 'JXBMC', 'jxb_id', 'classNo', 'jxbh'],
  term: ['xnxqdm', 'XNXQDM', 'term', 'xq'],
  score: ['cj', 'CJ', 'score', 'zf'],
  gradePoint: ['jd', 'JD', 'gpa', 'jdpj'],
};

export function pickField(row: Record<string, unknown>, key: keyof typeof FIELD_ALIASES): string | undefined {
  for (const alias of FIELD_ALIASES[key] ?? []) {
    const value = row[alias];
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (text !== '' && text !== 'null' && text !== 'undefined') return text;
  }
  return undefined;
}

export function pickNumber(row: Record<string, unknown>, key: keyof typeof FIELD_ALIASES): number | undefined {
  const text = pickField(row, key);
  if (text === undefined) return undefined;
  const value = Number(text.replace(/[^\d.-]/g, ''));
  return Number.isFinite(value) ? value : undefined;
}

const CATEGORY_RULES: { pattern: RegExp; category: CourseCategory }[] = [
  { pattern: /通识|通修|公共必修|思政|外语|体育/u, category: '通识通修' },
  { pattern: /大类|基础/u, category: '大类基础' },
  { pattern: /准入/u, category: '专业准入' },
  { pattern: /核心/u, category: '专业核心' },
  { pattern: /选修|任选/u, category: '专业选修' },
  { pattern: /实践|实验|实习|论文|设计/u, category: '实践环节' },
];

export function normalizeCategory(raw?: string): { category: CourseCategory; rawCategory?: string } {
  if (!raw) return { category: '未分类' };
  for (const rule of CATEGORY_RULES) {
    if (rule.pattern.test(raw)) return { category: rule.category, rawCategory: raw };
  }
  return { category: '未分类', rawCategory: raw };
}

/* ------------------------------------------------------------------ */
/* 周次与节次解析                                                      */
/* ------------------------------------------------------------------ */

function toHalfWidth(text: string): string {
  return text.replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0));
}

/**
 * 解析周次文本，支持：
 *   "1-16周" / "第1-16周" / "1-16周(单)" / "3-11周(单),13-16周" / "1,3,5,7周"
 * 解析失败返回 null，由调用方标记为待确认。
 */
export function parseWeeksText(input: string): WeekPattern | null {
  if (!input) return null;
  const text = toHalfWidth(input).replace(/[（）]/g, (c) => (c === '（' ? '(' : ')')).replace(/第/gu, '');
  const hasOdd = /(单|odd)/iu.test(text);
  const hasEven = /(双|even)/iu.test(text);

  const segments = text
    .replace(/\([^)]*\)/g, '')
    .split(/[,，、;；\s]+/)
    .map((part) => part.trim())
    .filter(Boolean);

  const weeks = new Set<number>();
  for (const segment of segments) {
    const range = /(\d{1,2})\s*[-~—至]\s*(\d{1,2})/.exec(segment);
    if (range) {
      const from = Number(range[1]);
      const to = Number(range[2]);
      if (!Number.isFinite(from) || !Number.isFinite(to)) continue;
      for (let week = Math.min(from, to); week <= Math.max(from, to); week += 1) {
        if (hasOdd && week % 2 === 0) continue;
        if (hasEven && week % 2 === 1) continue;
        weeks.add(week);
      }
      continue;
    }
    const single = /^(\d{1,2})$/.exec(segment.replace(/周/gu, ''));
    if (single) weeks.add(Number(single[1]));
  }

  if (weeks.size === 0) return null;
  const sorted = [...weeks].sort((a, b) => a - b);
  return {
    from: sorted[0]!,
    to: sorted[sorted.length - 1]!,
    parity: hasOdd ? 'odd' : hasEven ? 'even' : 'all',
    explicit: sorted,
  };
}

/** 解析 "第3-4节" / "3,4节" / "3-4" → [3,4] */
export function parsePeriodRange(input: string): { start: number; end: number } | null {
  if (!input) return null;
  const text = toHalfWidth(input).replace(/[（）()]/g, '').replace(/第|节/gu, '');
  const range = /(\d{1,2})\s*[-~—至]\s*(\d{1,2})/.exec(text);
  if (range) {
    const start = Number(range[1]);
    const end = Number(range[2]);
    return { start: Math.min(start, end), end: Math.max(start, end) };
  }
  const singles = text
    .split(/[,，、\s]+/)
    .map((part) => Number(part))
    .filter((value) => Number.isFinite(value));
  if (singles.length === 0) return null;
  return { start: Math.min(...singles), end: Math.max(...singles) };
}

const DAY_MAP: Record<string, number> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  日: 7,
  天: 7,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
  sun: 7,
};

export function parseDay(input: string): number | null {
  if (!input) return null;
  const text = input.trim().toLowerCase();
  const digit = /^([1-7])$/.exec(text);
  if (digit) return Number(digit[1]);
  const chinese = /(?:周|星期|礼拜)([一二三四五六日天])/u.exec(input);
  if (chinese?.[1] && DAY_MAP[chinese[1]]) return DAY_MAP[chinese[1]]!;
  if (DAY_MAP[text]) return DAY_MAP[text]!;
  const english = /(mon|tue|wed|thu|fri|sat|sun)/i.exec(text);
  if (english?.[1]) return DAY_MAP[english[1].toLowerCase()] ?? null;
  return null;
}

/** 从 "周一第3,4节{第1-16周}" 这类字符串里拆出完整的上课时间。 */
export function parseMeetingText(input: string): Meeting | null {
  if (!input) return null;
  const day = parseDay(input);
  const periodsText = /\{?第?\s*(\d{1,2})\s*[,，]\s*(\d{1,2})?\s*节/u.exec(input)?.[0] ?? input;
  const periods = parsePeriodRange(periodsText);
  if (day === null || !periods) return null;
  const weeksText = /\{([^}]*)\}/.exec(input)?.[1] ?? input;
  const weeks = parseWeeksText(weeksText) ?? { from: 1, to: 16, parity: 'all' as WeekParity };
  return { day, startPeriod: periods.start, endPeriod: periods.end, weeks };
}

/* ------------------------------------------------------------------ */
/* 行 → 模型                                                           */
/* ------------------------------------------------------------------ */

export interface NormalizedCourseRow {
  course: Partial<Course> & { code: string; name: string };
  ambiguous: string[];
}

export function normalizeCourseRow(row: Record<string, unknown>): NormalizedCourseRow | null {
  const code = pickField(row, 'courseCode');
  const name = pickField(row, 'courseName');
  if (!code || !name) return null;
  const ambiguous: string[] = [];
  const { category, rawCategory } = normalizeCategory(pickField(row, 'category'));
  const credits = pickNumber(row, 'credits');
  if (credits === undefined) ambiguous.push('学分');

  return {
    course: {
      id: code,
      code,
      name,
      credits: credits ?? 0,
      hours: pickNumber(row, 'hours'),
      department: pickField(row, 'department'),
      category,
      rawCategory,
      assessment: pickField(row, 'assessment'),
    },
    ambiguous,
  };
}

export interface NormalizedTimetableRow {
  courseCode: string;
  courseName: string;
  credits?: number;
  teacher?: string;
  meeting: Meeting | null;
  rawText: string;
}

/** 课表接口的行通常一行 = 一门课 + 一个时间段，需要按课程聚合成多个 Meeting。 */
export function normalizeTimetableRow(row: Record<string, unknown>): NormalizedTimetableRow | null {
  const courseCode = pickField(row, 'courseCode');
  const courseName = pickField(row, 'courseName');
  if (!courseCode || !courseName) return null;

  const rawText = [
    pickField(row, 'day'),
    pickField(row, 'periods'),
    pickField(row, 'weeks'),
  ]
    .filter(Boolean)
    .join(' ');

  const day = parseDay(pickField(row, 'day') ?? '');
  const periods = parsePeriodRange(pickField(row, 'periods') ?? '');
  const weeks = parseWeeksText(pickField(row, 'weeks') ?? '');

  let meeting: Meeting | null = null;
  if (day !== null && periods) {
    meeting = {
      day,
      startPeriod: periods.start,
      endPeriod: periods.end,
      weeks: weeks ?? { from: 1, to: 16, parity: 'all' },
      location: pickField(row, 'location'),
    };
  } else if (rawText) {
    meeting = parseMeetingText(rawText);
  }

  return {
    courseCode,
    courseName,
    credits: pickNumber(row, 'credits'),
    teacher: pickField(row, 'teacher'),
    meeting,
    rawText,
  };
}
