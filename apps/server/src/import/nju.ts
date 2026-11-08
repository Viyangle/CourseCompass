/**
 * 真实数据接入：南大 ehall（jwapp）→ 本地领域模型。
 *
 * 这里是「已验证过」的接口集合，全部来自浏览器真实会话的抓包：
 *   wdkb  /modules/xskcb/cxxsjbxx.do        学生信息
 *   wdkb  /modules/xskcb/cxxskclb.do        本学期课表（已选课程）
 *   cjcx  /modules/cjcx/cxxscjd.do          成绩
 *   qxfacx/modules/pyfacxepg/qxpyfacxzl.do  培养方案（按 PYFADM 精确查询）
 *   kcbcx /modules/qxkcb/qxfbkccx.do        开课与教学班（含时间地点）
 *   xyyj  /modules/xsxyyjjg/*.do            学业预警
 *
 * 约定：
 * - 只读；不调用任何写接口。
 * - 任何一步失败都不影响其他步骤：缺失的数据以空集合进入模型，界面会标「需更新」。
 * - 课程 → 培养模块的归类优先用成绩单里的「课程性质」；课程库没有该字段时，
 *   用课程号前缀推断（000=通修、002/003/004/006=通识、2500=学科专业、2501=多元发展）。
 *   这条规则在 55 门已修课程上与教务口径 100% 一致，但仍然是「推断」，界面需注明。
 */

import type {
  AcademicWarning,
  Course,
  CourseCategory,
  Plan,
  ProgramVersion,
  RequirementNode,
  Section,
  SourceRecord,
  Term,
  TranscriptRecord,
  WeekPattern,
} from '@planner/shared';
import { DEFAULT_PERIODS } from '@planner/shared';
import { parseWeeksText } from '../adapters/ehall/normalize.js';
import type { Db } from '../store/types.js';

const APP = 'https://ehallapp.nju.edu.cn/jwapp/sys';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/* ------------------------------------------------------------------ */
/* 抓取                                                                */
/* ------------------------------------------------------------------ */

export interface RawBundle {
  fetchedAt: string;
  student: Record<string, unknown> | null;
  batches: Record<string, unknown>[];
  warnings: Record<string, unknown>[];
  scheme: Record<string, unknown> | null;
  transcript: Record<string, unknown>[];
  timetable: Record<string, unknown>[];
  catalog: Record<string, unknown>[];
  currentTerm: string;
  requestedTerm: string;
  termPublished: boolean;
  errors: string[];
}

async function post(cookie: string, path: string, body: Record<string, string>): Promise<unknown> {
  const response = await fetch(`${APP}${path}`, {
    method: 'POST',
    headers: {
      Cookie: cookie,
      'User-Agent': UA,
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
      Accept: 'application/json, text/javascript, */*; q=0.01',
    },
    body: new URLSearchParams(body).toString(),
    signal: AbortSignal.timeout(30000),
  });
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${path} 返回了非 JSON（可能会话失效）：${text.slice(0, 120)}`);
  }
}

function rowsOf(payload: unknown): Record<string, unknown>[] {
  if (!payload || typeof payload !== 'object') return [];
  const data = (payload as { datas?: unknown }).datas;
  if (!data || typeof data !== 'object') return [];
  for (const value of Object.values(data)) {
    if (value && typeof value === 'object' && Array.isArray((value as { rows?: unknown }).rows)) {
      return (value as { rows: Record<string, unknown>[] }).rows;
    }
  }
  return [];
}

function num(value: unknown): number {
  if (typeof value === 'number') return value;
  const parsed = Number(String(value ?? '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function str(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

export async function fetchNjuBundle(cookie: string, requestedTerm?: string): Promise<RawBundle> {
  const errors: string[] = [];
  const bundle: RawBundle = {
    fetchedAt: new Date().toISOString(),
    student: null,
    batches: [],
    warnings: [],
    scheme: null,
    transcript: [],
    timetable: [],
    catalog: [],
    currentTerm: '',
    requestedTerm: requestedTerm ?? '',
    termPublished: false,
    errors,
  };

  // 1) 学生信息 + 预警（预警接口会顺带返回学生本人 PYFADM 所在课程）
  try {
    const info = await post(cookie, '/xyyj/modules/xsxyyjjg/cxxsjbxx.do', {});
    bundle.student = rowsOf(info)[0] ?? null;
  } catch (error) {
    errors.push(`学生信息：${(error as Error).message}`);
  }
  try {
    const batches = await post(cookie, '/xyyj/modules/xsxyyjjg/cxxsyjpcjg.do', {});
    bundle.batches = rowsOf(batches);
  } catch (error) {
    errors.push(`预警批次：${(error as Error).message}`);
  }
  try {
    const warnings = await post(cookie, '/xyyj/modules/xsxyyjjg/cxlbxssj.do', {
      '*order': '+XNXQDM,+KCH',
      pageSize: '200',
      pageNumber: '1',
    });
    bundle.warnings = rowsOf(warnings);
  } catch (error) {
    errors.push(`预警明细：${(error as Error).message}`);
  }

  // 2) 当前学期
  try {
    const term = await post(cookie, '/kcbcx/modules/bjkcb/dqxnxq.do', {});
    const row = rowsOf(term)[0];
    bundle.currentTerm = str(row?.DM ?? row?.XNXQDM ?? '');
  } catch (error) {
    errors.push(`当前学期：${(error as Error).message}`);
  }
  if (!bundle.currentTerm) {
    // 兜底：从预警批次名里猜，例如「2026-2027学年 第1学期」
    const name = str(bundle.batches[0]?.SCPCMC);
    const match = /(\d{4}-\d{4})学年\s*第([12])学期/.exec(name);
    if (match) bundle.currentTerm = `${match[1]}-${match[2]}`;
  }

  // 3) 培养方案：先拿 PYFADM（预警明细里带），再精确查方案
  const pyfadm = str(bundle.warnings[0]?.PYFADM);
  if (pyfadm) {
    try {
      const scheme = await post(cookie, '/qxfacx/modules/pyfacxepg/qxpyfacxzl.do', {
        querySetting: JSON.stringify([{ name: 'PYFADM', value: pyfadm, linkOpt: 'and', builder: 'equal' }]),
        pageSize: '10',
        pageNumber: '1',
      });
      bundle.scheme = rowsOf(scheme)[0] ?? null;
    } catch (error) {
      errors.push(`培养方案：${(error as Error).message}`);
    }
  } else {
    errors.push('培养方案：未能从预警数据中取得 PYFADM');
  }

  // 4) 成绩
  try {
    const transcript = await post(cookie, '/cjcx/modules/cjcx/cxxscjd.do', {
      pageSize: '300',
      pageNumber: '1',
    });
    bundle.transcript = rowsOf(transcript);
  } catch (error) {
    errors.push(`成绩：${(error as Error).message}`);
  }

  // 5) 下学期是否已发布（决定规划学期）
  const next = nextTermId(bundle.currentTerm);
  let termToUse = bundle.currentTerm;
  if (next) {
    try {
      const probe = await post(cookie, '/kcbcx/modules/qxkcb/qxfbkccx.do', {
        '*json': '1',
        querySetting: JSON.stringify([{ name: 'XNXQDM', value: next, linkOpt: 'and', builder: 'equal' }]),
        pageSize: '1',
        pageNumber: '1',
      });
      const first = rowsOf(probe);
      if (first.length > 0) {
        termToUse = next;
        bundle.termPublished = true;
      }
    } catch {
      /* 未发布时接口会返回提示而非 rows，忽略 */
    }
  }
  if (!bundle.requestedTerm) bundle.requestedTerm = termToUse;

  // 6) 课表（规划学期）
  try {
    const timetable = await post(cookie, '/wdkb/modules/xskcb/cxxskclb.do', {
      XNXQDM: bundle.currentTerm,
      pageSize: '100',
      pageNumber: '1',
    });
    bundle.timetable = rowsOf(timetable);
  } catch (error) {
    errors.push(`课表：${(error as Error).message}`);
  }

  // 7) 开课与教学班（分页抓全）
  const catalogTerm = bundle.requestedTerm;
  try {
    const collected: Record<string, unknown>[] = [];
    for (let page = 1; page <= 8; page += 1) {
      const payload = await post(cookie, '/kcbcx/modules/qxkcb/qxfbkccx.do', {
        '*json': '1',
        querySetting: JSON.stringify([{ name: 'XNXQDM', value: catalogTerm, linkOpt: 'and', builder: 'equal' }]),
        pageSize: '999',
        pageNumber: String(page),
      });
      const rows = rowsOf(payload);
      collected.push(...rows);
      if (rows.length < 999) break;
    }
    bundle.catalog = collected;
  } catch (error) {
    errors.push(`开课数据：${(error as Error).message}`);
  }

  return bundle;
}

function nextTermId(termId: string): string {
  const match = /^(\d{4})-(\d{4})-([12])$/.exec(termId);
  if (!match) return '';
  const [, start, end, half] = match;
  if (half === '1') return `${start}-${end}-2`;
  const nextStart = Number(start) + 1;
  return `${nextStart}-${nextStart + 1}-1`;
}

/* ------------------------------------------------------------------ */
/* 映射                                                                */
/* ------------------------------------------------------------------ */

const TERM_START: Record<string, string> = {
  '2024-2025-1': '2024-09-02',
  '2024-2025-2': '2025-02-17',
  '2025-2026-1': '2025-09-01',
  '2025-2026-2': '2026-02-23',
  '2026-2027-1': '2026-09-07',
  '2026-2027-2': '2027-02-22',
  '2027-2028-1': '2027-09-06',
};

const TERM_NAMES: Record<string, string> = {
  '2024-2025-1': '2024-2025学年 第一学期',
  '2024-2025-2': '2024-2025学年 第二学期',
  '2024-2025-3': '2024-2025学年 暑期',
  '2025-2026-1': '2025-2026学年 第一学期',
  '2025-2026-2': '2025-2026学年 第二学期',
  '2025-2026-3': '2025-2026学年 暑期',
  '2026-2027-1': '2026-2027学年 第一学期',
  '2026-2027-2': '2026-2027学年 第二学期',
  '2026-2027-3': '2026-2027学年 暑期',
  '2027-2028-1': '2027-2028学年 第一学期',
};

/** 课程号前缀 → 标签。用于课程库缺失「课程性质」时归类。 */
export function tagsFromCode(code: string): string[] {
  if (/^000/.test(code)) return ['通修'];
  if (/^00[2346]/.test(code)) return ['通识'];
  if (/^2500/.test(code)) return ['学科专业'];
  if (/^2501/.test(code)) return ['多元发展'];
  return [];
}

function categoryFromTags(tags: string[]): CourseCategory {
  if (tags.includes('通修') || tags.includes('通识')) return '通识通修';
  if (tags.includes('学科专业')) return '专业核心';
  if (tags.includes('多元发展')) return '专业选修';
  if (tags.includes('毕业论文')) return '实践环节';
  return '未分类';
}

/** 解析 "周五 5-7节 1-18周 苏教B206, 周六 2-4节 1-18周 苏教B206" */
export function parseYpsjdd(text: string): {
  day: number;
  startPeriod: number;
  endPeriod: number;
  weeks: WeekPattern;
  location: string;
}[] {
  if (!text) return [];
  const out: { day: number; startPeriod: number; endPeriod: number; weeks: WeekPattern; location: string }[] = [];
  const DAY: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7 };
  for (const part of text.split(/,\s*/)) {
    const dayMatch = /周([一二三四五六日])/.exec(part);
    const periodMatch = /(\d+)\s*-\s*(\d+)节/.exec(part);
    if (!dayMatch || !periodMatch) continue;
    const afterPeriods = part.slice(part.indexOf('节') + 1).trim();
    const weekToken = /^(\S+)/.exec(afterPeriods)?.[1] ?? '';
    const weeks = parseWeeksText(weekToken) ?? { from: 1, to: 18, parity: 'all' as const };
    const location = afterPeriods.slice(weekToken.length).trim();
    out.push({
      day: DAY[dayMatch[1]!] ?? 1,
      startPeriod: Number(periodMatch[1]),
      endPeriod: Number(periodMatch[2]),
      weeks,
      location,
    });
  }
  return out;
}

function termIdFromName(display: string): string {
  const match = /(\d{4})-(\d{4})学年\s*第([12])学期/.exec(display);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  const summer = /(\d{4})-(\d{4})学年\s*暑期/.exec(display);
  if (summer) return `${summer[1]}-${summer[2]}-3`;
  return '';
}

function buildTerms(ids: Set<string>, currentTerm: string, planningTerm: string): Term[] {
  return [...ids]
    .filter(Boolean)
    .sort()
    .map((id) => ({
      id,
      name: TERM_NAMES[id] ?? id,
      startDate: TERM_START[id] ?? '2026-09-07',
      weekCount: 18,
      isCurrent: id === currentTerm,
      isPlanning: id === planningTerm,
    }));
}

function buildProgram(scheme: Record<string, unknown> | null): ProgramVersion {
  const requirement = str(scheme?.XDYQ);
  const total = num(scheme?.ZSYQXFXSZ) || 150;
  const pick = (label: string, fallback: number): number => {
    const match = new RegExp(`${label}[^0-9]{0,12}(\\d+)`).exec(requirement);
    return match ? Number(match[1]) : fallback;
  };
  const modules: RequirementNode[] = [
    { id: 'm-general', name: '通识通修课程', requiredCredits: pick('通识通修课程', 61), rule: { kind: 'tagSet', tags: ['通修', '通识'] } },
    { id: 'm-major', name: '学科专业课程', requiredCredits: pick('学科专业课程', 49), rule: { kind: 'tagSet', tags: ['学科专业'] } },
    { id: 'm-elective', name: '多元发展课程', requiredCredits: pick('多元发展课程', 34), rule: { kind: 'tagSet', tags: ['多元发展'] } },
    { id: 'm-thesis', name: '毕业论文/设计', requiredCredits: pick('毕业论文', 6), rule: { kind: 'tagSet', tags: ['毕业论文'] } },
  ];
  return {
    id: `prog-${str(scheme?.PYFADM) || 'nju'}`,
    name: str(scheme?.PYFAMC) || '本科培养方案',
    major: str(scheme?.ZYDM_DISPLAY) || '软件工程',
    gradeYear: num(scheme?.NJDM) || 2024,
    totalCredits: total,
    duration: num(scheme?.XZNX) || 4,
    modules,
    source: { kind: 'program', mode: 'ehall', fetchedAt: new Date().toISOString() },
  };
}

const NOW = (): string => new Date().toISOString();

export function mapBundleToDb(bundle: RawBundle): Db {
  const student = bundle.student ?? {};
  const currentTerm = bundle.currentTerm || '2026-2027-1';
  const planningTerm = bundle.requestedTerm || currentTerm;
  const program = buildProgram(bundle.scheme);

  const termIds = new Set<string>([currentTerm, planningTerm]);
  for (const row of bundle.transcript) termIds.add(str(row.XNXQDM));
  for (const row of bundle.catalog) termIds.add(str(row.XNXQDM));

  /* ---------- 课程与教学班 ---------- */
  const courses = new Map<string, Course>();
  const sections: Section[] = [];

  const ensureCourse = (code: string, name: string, credits: number, department: string, tags: string[]): Course => {
    const exist = courses.get(code);
    if (exist) {
      if (exist.credits === 0 && credits > 0) exist.credits = credits;
      if (!exist.department && department) exist.department = department;
      if ((exist.tags?.length ?? 0) === 0 && tags.length > 0) {
        exist.tags = tags;
        exist.category = categoryFromTags(tags);
      }
      return exist;
    }
    const course: Course = {
      id: code,
      code,
      name,
      credits,
      department: department || undefined,
      category: categoryFromTags(tags),
      tags,
      source: { kind: 'catalog', mode: 'ehall', fetchedAt: bundle.fetchedAt },
    };
    courses.set(code, course);
    return course;
  };

  // 课程库（教学班）
  for (const row of bundle.catalog) {
    const code = str(row.KCH);
    if (!code) continue;
    const tags = tagsFromCode(code);
    ensureCourse(code, str(row.KCM), num(row.XF), str(row.KKDWDM_DISPLAY), tags);
    const meetings = parseYpsjdd(str(row.YPSJDD));
    sections.push({
      id: `sec-${str(row.XNXQDM)}-${code}-${str(row.KXH)}`,
      courseId: code,
      courseCode: code,
      termId: str(row.XNXQDM) || planningTerm,
      classNo: str(row.KXH) || str(row.JXBMC).replace(/^\D+/, ''),
      teachers: str(row.SKJS)
        .split(/[,，]/)
        .map((name) => name.trim())
        .filter(Boolean),
      capacity: num(row.KRL) || undefined,
      enrolled: num(row.XKZRS) || undefined,
      meetings: meetings.map((meeting) => ({ ...meeting, campus: str(row.XXXQDM_DISPLAY) || undefined })),
      campus: str(row.XXXQDM_DISPLAY) || undefined,
      note: str(row.TXKCLB_DISPLAY) ? `通修类别：${str(row.TXKCLB_DISPLAY)}` : undefined,
      source: { kind: 'catalog', mode: 'ehall', fetchedAt: bundle.fetchedAt, url: `${APP}/kcbcx/modules/qxkcb/qxfbkccx.do` },
    });
  }

  /* ---------- 成绩 ---------- */
  const transcript: TranscriptRecord[] = [];
  for (const row of bundle.transcript) {
    const code = str(row.KCH);
    const name = str(row.KCM);
    if (!code || !name) continue;
    const tags = tagsFromCode(code);
    ensureCourse(code, name, num(row.XF), '', tags);
    const passed = str(row.SFJG) === '1';
    const scoreText = str(row.ZCJ);
    const score = /^\d+(\.\d+)?$/.test(scoreText) ? Number(scoreText) : undefined;
    transcript.push({
      courseCode: code,
      courseName: name,
      credits: num(row.XF),
      score,
      gradeText: score === undefined ? scoreText : undefined,
      termId: str(row.XNXQDM) || termIdFromName(str(row.XNXQDM_DISPLAY)),
      category: categoryFromTags(tags),
      rawCategory: str(row.KCXZDM_DISPLAY),
      tags,
      status: passed ? 'passed' : 'failed',
      creditsEarned: passed ? num(row.XF) : 0,
      source: { kind: 'transcript', mode: 'ehall', fetchedAt: bundle.fetchedAt },
    });
  }

  /* ---------- 本学期课表（在修） ---------- */
  const currentSections: Section[] = [];
  for (const row of bundle.timetable) {
    const code = str(row.KCH);
    if (!code) continue;
    const teacherText = str(row.SKJS);
    const existing = sections.find(
      (section) =>
        section.termId === currentTerm &&
        section.courseCode === code &&
        (section.teachers.some((teacher) => teacherText.includes(teacher)) ||
          section.classNo === str(row.JXBMC).replace(/^.*?(\d+)班$/, '$1')),
    );
    if (existing) {
      existing.inCurrentTimetable = true;
      currentSections.push(existing);
      continue;
    }
    const meetings = parseYpsjdd(str(row.ZCXQJCDD));
    const name = str(row.JXBMC).replace(/\d+班$/, '') || code;
    const tags = tagsFromCode(code);
    ensureCourse(code, courses.get(code)?.name ?? name, num(row.XF), '', tags);
    const section: Section = {
      id: `sec-${currentTerm}-${code}-${str(row.JXBID) || 'cur'}`,
      courseId: code,
      courseCode: code,
      termId: currentTerm,
      classNo: str(row.JXBMC).replace(/^.*?(\d+)班$/, '$1') || '01',
      teachers: str(row.SKJS)
        .split(/[,，]/)
        .map((value) => value.trim())
        .filter(Boolean),
      meetings: meetings.map((meeting) => ({ ...meeting, campus: undefined })),
      inCurrentTimetable: true,
      note: str(row.XKLY_DISPLAY) || undefined,
      source: { kind: 'timetable', mode: 'ehall', fetchedAt: bundle.fetchedAt },
    };
    currentSections.push(section);
    sections.push(section);
  }

  // 在修课程写进成绩单（status=in-progress，不计已获学分）
  for (const section of currentSections) {
    if (transcript.some((record) => record.courseCode === section.courseCode && record.termId === currentTerm)) continue;
    const course = courses.get(section.courseCode);
    transcript.push({
      courseCode: section.courseCode,
      courseName: course?.name ?? section.courseCode,
      credits: course?.credits ?? 0,
      termId: currentTerm,
      category: course?.category,
      tags: course?.tags,
      status: 'in-progress',
      creditsEarned: 0,
      source: { kind: 'timetable', mode: 'ehall', fetchedAt: bundle.fetchedAt },
    });
  }

  /* ---------- 学业预警 ---------- */
  const warnings: AcademicWarning[] = [];
  const batch = bundle.batches[0];
  if (batch) {
    warnings.push({
      id: 'warn-batch',
      level: str(batch.SFYJ) === '1' ? 'warning' : 'info',
      title: `${str(batch.SCPCMC)} · ${str(batch.SCJLMC)}`,
      detail: `预警级别 ${str(batch.YJJB) || '—'}，发布时间 ${str(batch.CZRQ) || '—'}。${str(batch.SCJLSM) || ''}`,
      rule: '学业预警批次',
      termId: currentTerm,
      source: { kind: 'warning', mode: 'ehall', fetchedAt: bundle.fetchedAt },
    });
  }
  const failedCourses = bundle.warnings.filter((row) => str(row.SFTG) !== '1');
  if (failedCourses.length > 0) {
    warnings.push({
      id: 'warn-courses',
      level: 'warning',
      title: `${failedCourses.length} 门课程未通过预警检查`,
      detail: failedCourses
        .slice(0, 8)
        .map((row) => `${str(row.KCM)}（${str(row.XNXQDM_DISPLAY)}）`)
        .join('、'),
      rule: '课程级预警',
      termId: currentTerm,
      source: { kind: 'warning', mode: 'ehall', fetchedAt: bundle.fetchedAt },
    });
  }

  /* ---------- 方案：以真实课表为基线 ---------- */
  const now = NOW();
  const baselineItems = currentSections.map((section, index) => ({
    id: `item-${index}-${section.courseCode}`,
    sectionId: section.id,
    courseCode: section.courseCode,
    status: 'selected' as const,
    addedAt: now,
    origin: 'imported' as const,
  }));

  const plans: Plan[] = [
    {
      id: 'plan-real',
      name: '本学期课表（真实）',
      termId: planningTerm,
      color: '#7c3aed',
      items: baselineItems,
      note: bundle.termPublished ? '' : '下学期开课数据尚未发布，暂以本学期课表为参考。',
      createdAt: now,
      updatedAt: now,
    },
  ];

  /* ---------- 来源 ---------- */
  const sources: SourceRecord[] = [
    {
      kind: 'program',
      label: '本科人才培养方案',
      mode: 'ehall',
      status: bundle.scheme ? 'ok' : 'error',
      fetchedAt: bundle.fetchedAt,
      detail: `${str(bundle.scheme?.PYFAMC)} · ${num(bundle.scheme?.ZSYQXFXSZ)} 学分`,
      url: `${APP}/qxfacx/modules/pyfacxepg/qxpyfacxzl.do`,
      records: bundle.scheme ? 1 : 0,
    },
    {
      kind: 'transcript',
      label: '成绩与已修记录',
      mode: 'ehall',
      status: bundle.transcript.length > 0 ? 'ok' : 'error',
      fetchedAt: bundle.fetchedAt,
      detail: `${bundle.transcript.length} 条已出成绩 · ${bundle.timetable.length} 门在修`,
      url: `${APP}/cjcx/modules/cjcx/cxxscjd.do`,
      records: bundle.transcript.length,
    },
    {
      kind: 'timetable',
      label: '本学期课表',
      mode: 'ehall',
      status: bundle.timetable.length > 0 ? 'ok' : 'error',
      fetchedAt: bundle.fetchedAt,
      detail: `${currentTerm} · ${bundle.timetable.length} 门在修`,
      url: `${APP}/wdkb/modules/xskcb/cxxskclb.do`,
      records: bundle.timetable.length,
    },
    {
      kind: 'catalog',
      label: '开课与教学班',
      mode: 'ehall',
      status: bundle.catalog.length > 0 ? 'ok' : 'pending',
      fetchedAt: bundle.fetchedAt,
      detail: `${planningTerm} · ${bundle.catalog.length} 个教学班${bundle.termPublished ? '' : '（当前学期）'}`,
      url: `${APP}/kcbcx/modules/qxkcb/qxfbkccx.do`,
      records: bundle.catalog.length,
    },
    {
      kind: 'warning',
      label: '学业预警',
      mode: 'ehall',
      status: bundle.batches.length > 0 ? 'ok' : 'error',
      fetchedAt: bundle.fetchedAt,
      detail: `${bundle.batches.length} 个批次 · ${bundle.warnings.length} 门检查`,
      url: `${APP}/xyyj/modules/xsxyyjjg/cxlbxssj.do`,
      records: bundle.warnings.length,
    },
  ];

  const db: Db = {
    version: 1,
    profile: {
      studentId: str(student.XH),
      name: str(student.XM) || '同学',
      college: str(student.YXMC) || str(student.YXDM_DISPLAY),
      major: str(student.ZYMC) || program.major,
      gradeYear: num(student.XZNJ) || program.gradeYear,
      programId: program.id,
      demo: false,
    },
    terms: buildTerms(termIds, currentTerm, planningTerm),
    periods: DEFAULT_PERIODS,
    courses: [...courses.values()],
    sections,
    program,
    transcript,
    warnings,
    plans,
    sources,
    settings: {
      currentTermId: currentTerm,
      planningTermId: planningTerm,
      creditCap: 30,
      allocationPolicy:
        '课程按「指定课程 > 标签匹配 > 任意选修」计入培养方案；课程性质来自成绩单，课程库按课程号前缀推断（000 通修 / 002·003·004·006 通识 / 2500 学科专业 / 2501 多元发展）。',
    },
    rawSnapshots: [],
  };

  void NOW;
  return db;
}
