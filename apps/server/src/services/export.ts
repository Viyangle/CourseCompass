/**
 * 导出：把方案变成"能拿去用"的东西。
 *
 * 三种格式对应三种真实场景：
 * - Markdown：贴进笔记 / 交给同学看；
 * - CSV：和正式选课页面的列表对照，或者自己再加工；
 * - ICS：导入手机日历，上课前提醒。
 *
 * 特别注意：导出内容里不包含学号与姓名，避免被随手转发时泄露。
 */

import type { Plan, Section, Meeting } from '@planner/shared';
import { formatDay, formatWeekPattern, formatWeeks, patternToMask } from '@planner/shared';
import type { Db } from '../store/types.js';

interface ExportRow {
  course: { code: string; name: string; credits: number; category: string; assessment?: string };
  section: Section;
  timeText: string;
  location: string;
  teachers: string;
}

function collect(db: Db, plan: Plan): ExportRow[] {
  const courseByCode = new Map(db.courses.map((course) => [course.code, course]));
  const rows: ExportRow[] = [];
  for (const item of plan.items) {
    if (item.status !== 'selected') continue;
    const section = db.sections.find((s) => s.id === item.sectionId);
    if (!section) continue;
    const course = courseByCode.get(section.courseCode);
    if (!course) continue;
    const timeText = section.meetings
      .map((meeting) => `${formatDay(meeting.day)} 第${meeting.startPeriod}-${meeting.endPeriod}节 ${formatWeekPattern(meeting.weeks)}`)
      .join('；');
    const locations = [...new Set(section.meetings.map((meeting) => meeting.location).filter(Boolean))];
    rows.push({
      course: {
        code: course.code,
        name: course.name,
        credits: course.credits,
        category: course.category,
        assessment: course.assessment,
      },
      section,
      timeText: timeText || '（无固定上课时间）',
      location: locations.join(' / ') || section.campus || '—',
      teachers: section.teachers.join('、') || '—',
    });
  }
  return rows.sort((a, b) => a.course.code.localeCompare(b.course.code));
}

function termName(db: Db, plan: Plan): string {
  return db.terms.find((t) => t.id === plan.termId)?.name ?? plan.termId;
}

export function exportPlanMarkdown(db: Db, plan: Plan): string {
  const rows = collect(db, plan);
  const total = rows.reduce((sum, row) => sum + row.course.credits, 0);
  const lines: string[] = [];
  lines.push(`# ${plan.name}`);
  lines.push('');
  lines.push(`- 学期：${termName(db, plan)}`);
  lines.push(`- 学分：${total} 学分 / ${rows.length} 门课`);
  lines.push(`- 导出时间：${new Date().toLocaleString('zh-CN')}`);
  lines.push('');
  lines.push('> 本清单用于对照学校正式选课系统，不构成选课结果。');
  lines.push('');
  lines.push('| 课程号 | 课程名称 | 学分 | 教学班 | 教师 | 时间 | 地点 | 考核 |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const row of rows) {
    lines.push(
      `| ${row.course.code} | ${row.course.name} | ${row.course.credits} | ${row.section.classNo} | ${row.teachers} | ${row.timeText} | ${row.location} | ${row.course.assessment ?? '—'} |`,
    );
  }
  if (plan.note) {
    lines.push('');
    lines.push(`备注：${plan.note}`);
  }
  return lines.join('\n');
}

export function exportPlanCsv(db: Db, plan: Plan): string {
  const rows = collect(db, plan);
  const header = ['课程号', '课程名称', '学分', '课程类别', '教学班', '教师', '上课时间', '地点', '考核方式'];
  const lines = [header.join(',')];
  for (const row of rows) {
    const cells = [
      row.course.code,
      row.course.name,
      String(row.course.credits),
      row.course.category,
      row.section.classNo,
      row.teachers,
      row.timeText,
      row.location,
      row.course.assessment ?? '',
    ].map((cell) => `"${cell.replace(/"/g, '""')}"`);
    lines.push(cells.join(','));
  }
  // BOM 让 Excel 正确识别 UTF-8
  return `\uFEFF${lines.join('\r\n')}`;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function icsDate(termStart: string, week: number, day: number, time: string): string {
  const start = new Date(`${termStart}T00:00:00+08:00`);
  const date = new Date(start.getTime() + ((week - 1) * 7 + (day - 1)) * 86_400_000);
  const [hour, minute] = time.split(':').map(Number);
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}T${pad(hour!)}${pad(minute!)}00`;
}

const BYDAY = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

export function exportPlanIcs(db: Db, plan: Plan): string {
  const term = db.terms.find((t) => t.id === plan.termId);
  if (!term) return '';
  const periods = db.periods.length > 0 ? db.periods : [];
  const timeOf = (period: number): { start: string; end: string } => {
    const found = periods.find((p) => p.period === period);
    return found ?? { start: '08:00', end: '08:50' };
  };

  const rows = collect(db, plan);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//NJU Course Planner//Course Plan//CN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${plan.name}`,
    'BEGIN:VTIMEZONE',
    'TZID:Asia/Shanghai',
    'BEGIN:STANDARD',
    'DTSTART:19700101T000000',
    'TZOFFSETFROM:+0800',
    'TZOFFSETTO:+0800',
    'TZNAME:CST',
    'END:STANDARD',
    'END:VTIMEZONE',
  ];

  rows.forEach((row, index) => {
    row.section.meetings.forEach((meeting: Meeting, meetingIndex) => {
      const startPeriod = timeOf(meeting.startPeriod);
      const endPeriod = timeOf(meeting.endPeriod);
      const weeks = patternToMask(meeting.weeks);
      const firstWeek = Math.max(1, Math.ceil(Math.log2(weeks & -weeks) + 1));
      const dtStart = icsDate(term.startDate, firstWeek, meeting.day, startPeriod.start);
      const dtEnd = icsDate(term.startDate, firstWeek, meeting.day, endPeriod.end);
      const count = countWeeks(weeks);

      lines.push('BEGIN:VEVENT');
      lines.push(`UID:plan-${plan.id}-${index}-${meetingIndex}@nju-planner`);
      lines.push(`DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').split('.')[0]}Z`);
      lines.push(`DTSTART;TZID=Asia/Shanghai:${dtStart}`);
      lines.push(`DTEND;TZID=Asia/Shanghai:${dtEnd}`);
      lines.push(`RRULE:FREQ=WEEKLY;COUNT=${count};INTERVAL=${meeting.weeks.parity === 'all' ? 1 : 2};BYDAY=${BYDAY[meeting.day - 1] ?? 'MO'}`);
      lines.push(`SUMMARY:${row.course.name}`);
      lines.push(`LOCATION:${meeting.location ?? row.location}`);
      lines.push(`DESCRIPTION:${row.course.code} ${row.teachers} ${formatWeeks(weeks)}`);
      lines.push('END:VEVENT');
    });
  });

  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

function countWeeks(mask: number): number {
  let count = 0;
  for (let week = 1; week <= 31; week += 1) if (mask & (1 << (week - 1))) count += 1;
  return Math.max(1, count);
}
