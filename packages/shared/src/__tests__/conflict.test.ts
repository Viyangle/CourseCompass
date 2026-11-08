import { describe, expect, it } from 'vitest';
import { detectConflicts } from '../conflict.js';
import type { Course, Plan, Section } from '../types.js';

const courses: Course[] = [
  { id: 'A', code: 'A', name: '数据结构', credits: 4, category: '专业核心' },
  { id: 'B', code: 'B', name: '概率论', credits: 3, category: '大类基础' },
  { id: 'C', code: 'C', name: '社会学导论', credits: 2, category: '通识通修' },
];

function section(id: string, code: string, day: number, start: number, end: number, parity: 'all' | 'odd' | 'even' = 'all'): Section {
  return {
    id,
    courseId: code,
    courseCode: code,
    termId: '2026-2027-2',
    classNo: '01',
    teachers: ['张老师'],
    meetings: [{ day, startPeriod: start, endPeriod: end, weeks: { from: 1, to: 16, parity } }],
  };
}

function plan(items: { sectionId: string; courseCode: string }[]): Plan {
  return {
    id: 'p1',
    name: '方案 A',
    termId: '2026-2027-2',
    items: items.map((item, index) => ({
      id: `i${index}`,
      sectionId: item.sectionId,
      courseCode: item.courseCode,
      status: 'selected',
      addedAt: '2026-11-08T00:00:00.000Z',
    })),
    createdAt: '2026-11-08T00:00:00.000Z',
    updatedAt: '2026-11-08T00:00:00.000Z',
  };
}

describe('detectConflicts', () => {
  it('同一天同一节次报时间冲突，并给出周次', () => {
    const sections = [section('s1', 'A', 3, 3, 4), section('s2', 'B', 3, 4, 5)];
    const issues = detectConflicts(plan([{ sectionId: 's1', courseCode: 'A' }, { sectionId: 's2', courseCode: 'B' }]), {
      sections,
      courses,
      weekCount: 16,
      termId: '2026-2027-2',
    });
    const time = issues.filter((i) => i.kind === 'time');
    expect(time).toHaveLength(1);
    expect(time[0]!.severity).toBe('error');
    expect(time[0]!.time).toMatchObject({ day: 3, startPeriod: 4, endPeriod: 4 });
    expect(time[0]!.time!.weeks[0]).toBe(1);
  });

  it('单周与双周同一格不算冲突', () => {
    const sections = [section('s1', 'A', 2, 1, 2, 'odd'), section('s2', 'B', 2, 1, 2, 'even')];
    const issues = detectConflicts(plan([{ sectionId: 's1', courseCode: 'A' }, { sectionId: 's2', courseCode: 'B' }]), {
      sections,
      courses,
      weekCount: 16,
      termId: '2026-2027-2',
    });
    expect(issues.filter((i) => i.kind === 'time')).toHaveLength(0);
  });

  it('同课程两个教学班给 warning', () => {
    const sections = [section('s1', 'A', 1, 1, 2), section('s2', 'A', 4, 1, 2)];
    const issues = detectConflicts(plan([{ sectionId: 's1', courseCode: 'A' }, { sectionId: 's2', courseCode: 'A' }]), {
      sections,
      courses,
      weekCount: 16,
      termId: '2026-2027-2',
    });
    expect(issues.some((i) => i.kind === 'duplicate-course')).toBe(true);
  });

  it('已修课程提示重复修读', () => {
    const sections = [section('s1', 'A', 1, 1, 2)];
    const issues = detectConflicts(plan([{ sectionId: 's1', courseCode: 'A' }]), {
      sections,
      courses,
      weekCount: 16,
      termId: '2026-2027-2',
      transcript: [
        {
          courseCode: 'A',
          courseName: '数据结构',
          credits: 4,
          termId: '2025-2026-2',
          status: 'passed',
          creditsEarned: 4,
        },
      ],
    });
    expect(issues.some((i) => i.kind === 'already-passed')).toBe(true);
  });

  it('学分上限触发提示', () => {
    const sections = [section('s1', 'A', 1, 1, 2), section('s2', 'B', 2, 1, 2), section('s3', 'C', 4, 1, 2)];
    const issues = detectConflicts(plan([{ sectionId: 's1', courseCode: 'A' }, { sectionId: 's2', courseCode: 'B' }, { sectionId: 's3', courseCode: 'C' }]), {
      sections,
      courses,
      weekCount: 16,
      termId: '2026-2027-2',
      creditCap: 6,
    });
    const issue = issues.find((i) => i.kind === 'credit-cap');
    expect(issue?.message).toContain('9 学分');
  });
});
