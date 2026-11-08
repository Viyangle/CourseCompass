import { formatDay, formatWeekPattern, type CourseCategory, type Section } from '@planner/shared';

export const CATEGORY_LABELS: Record<CourseCategory, string> = {
  通识通修: '通识通修',
  大类基础: '大类基础',
  专业准入: '专业准入',
  专业核心: '专业核心',
  专业选修: '专业选修',
  公共选修: '公共选修',
  实践环节: '实践环节',
  未分类: '未分类',
};

export const CATEGORY_COLORS: Record<CourseCategory, string> = {
  通识通修: 'var(--cat-general)',
  大类基础: 'var(--cat-foundation)',
  专业准入: 'var(--cat-admission)',
  专业核心: 'var(--cat-core)',
  专业选修: 'var(--cat-elective)',
  公共选修: 'var(--cat-elective)',
  实践环节: 'var(--cat-practice)',
  未分类: 'var(--muted)',
};

export function categoryColor(category: CourseCategory | string | undefined): string {
  return CATEGORY_COLORS[(category as CourseCategory) ?? '未分类'] ?? 'var(--muted)';
}

/** 一个教学班的时间文案：「周一 1-2节 · 周三 3-4节（1-16周）」 */
export function meetingText(section: Section): string {
  if (section.meetings.length === 0) return '无固定上课时间';
  return section.meetings
    .map(
      (meeting) =>
        `${formatDay(meeting.day)} ${meeting.startPeriod}-${meeting.endPeriod}节（${formatWeekPattern(meeting.weeks)}）`,
    )
    .join(' · ');
}

export function shortMeetingText(section: Section): string {
  if (section.meetings.length === 0) return '线上 / 待定';
  return section.meetings
    .map((meeting) => `${formatDay(meeting.day).replace('周', '')}${meeting.startPeriod}-${meeting.endPeriod}`)
    .join(' ');
}

export function teachersText(section: Section): string {
  return section.teachers.length > 0 ? section.teachers.join('、') : '教师待定';
}

/** 节次范围 → "上午/下午/晚上" */
export function timeBucketLabel(start: number, end: number): string {
  if (end <= 4) return '上午';
  if (end <= 8) return '下午';
  return '晚上';
}
