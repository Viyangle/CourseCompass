import { describe, expect, it } from 'vitest';
import { computeProgramProgress, resolveCourseRequirementIds, suggestCoursesForNode } from '../progress.js';
import type { Course, ProgramVersion, RequirementNode, TranscriptRecord } from '../types.js';

const modules: RequirementNode[] = [
  {
    id: 'general',
    name: '通识通修',
    requiredCredits: 6,
    children: [
      {
        id: 'politics',
        name: '思想政治理论',
        requiredCredits: 4,
        rule: { kind: 'tagSet', tags: ['思政'] },
      },
      {
        id: 'humanities',
        name: '通识选修',
        requiredCredits: 2,
        rule: { kind: 'tagSet', tags: ['通识'] },
      },
    ],
  },
  {
    id: 'core',
    name: '专业核心',
    requiredCredits: 8,
    children: [
      {
        id: 'core-a',
        name: '核心必修 A',
        requiredCredits: 4,
        rule: { kind: 'courseSet', courseCodes: ['CS101'] },
      },
      {
        id: 'core-elective',
        name: '专业选修',
        requiredCredits: 4,
        rule: { kind: 'tagSet', tags: ['专业选修'] },
      },
    ],
  },
];

const program: ProgramVersion = {
  id: 'prog',
  name: '测试培养方案',
  major: '计算机',
  gradeYear: 2024,
  totalCredits: 14,
  duration: 4,
  modules,
};

function record(code: string, credits: number, extra: Partial<TranscriptRecord> = {}): TranscriptRecord {
  return {
    courseCode: code,
    courseName: code,
    credits,
    termId: '2025-2026-1',
    status: 'passed',
    creditsEarned: credits,
    tags: ['思政'],
    ...extra,
  };
}

describe('computeProgramProgress', () => {
  it('按标签与课程号分配学分，并汇总父节点', () => {
    const result = computeProgramProgress({
      program,
      transcript: [record('MARX1', 2), record('CS101', 4)],
      planned: [],
    });
    const general = result.modules.find((m) => m.nodeId === 'general')!;
    expect(general.children?.find((c) => c.nodeId === 'politics')!.earnedCredits).toBe(2);
    expect(general.earnedCredits).toBe(2);
    const core = result.modules.find((m) => m.nodeId === 'core')!;
    expect(core.earnedCredits).toBe(4);
    expect(result.totalEarned).toBe(6);
    expect(result.totalRemaining).toBe(8);
  });

  it('同一门课不会被算进两个模块', () => {
    const overlapping: ProgramVersion = {
      ...program,
      modules: [
        { ...modules[0]!, requiredCredits: 2 },
        modules[1]!,
      ],
    };
    const result = computeProgramProgress({
      program: overlapping,
      transcript: [record('MARX1', 2)],
      planned: [record('MARX1', 2)],
    });
    const total = result.modules.reduce((sum, m) => sum + m.earnedCredits, 0);
    expect(total).toBe(2);
    expect(result.unmapped).toHaveLength(0);
  });

  it('计划中的课程让模块从 short 变为 planned', () => {
    const result = computeProgramProgress({
      program,
      transcript: [record('MARX1', 2)],
      planned: [{ courseCode: 'MARX2', courseName: 'MARX2', credits: 2, tags: ['思政'] }],
    });
    const politics = result.modules[0]!.children!.find((c) => c.nodeId === 'politics')!;
    expect(politics.plannedCredits).toBe(2);
    expect(politics.status).toBe('planned');
    expect(politics.coveredByPlan).toBe(true);
  });

  it('匹配不到模块的课程进入 unmapped', () => {
    const result = computeProgramProgress({
      program,
      transcript: [record('UNKNOWN', 3, { tags: [] })],
      planned: [],
    });
    expect(result.unmapped.map((u) => u.courseCode)).toEqual(['UNKNOWN']);
  });

  it('成绩单缺少标签时，用课程库补齐后再匹配', () => {
    const catalog: Course[] = [
      { id: 'M1', code: 'M1', name: '马克思主义基本原理', credits: 2, category: '通识通修', tags: ['思政'] },
    ];
    const result = computeProgramProgress({
      program,
      transcript: [record('M1', 2, { tags: undefined })],
      planned: [],
      courses: catalog,
    });
    const politics = result.modules[0]!.children!.find((c) => c.nodeId === 'politics')!;
    expect(politics.earnedCredits).toBe(2);
  });
});

describe('requirement index', () => {
  const courses: Course[] = [
    { id: 'M1', code: 'M1', name: '马克思主义基本原理', credits: 3, category: '通识通修', tags: ['思政'] },
    { id: 'E1', code: 'E1', name: '艺术导论', credits: 2, category: '通识通修', tags: ['通识'] },
  ];

  it('标签课程能反查到模块', () => {
    expect(resolveCourseRequirementIds(program, courses[0]!)).toContain('politics');
    expect(resolveCourseRequirementIds(program, courses[1]!)).toContain('humanities');
  });

  it('推荐课程会排除已修与已选', () => {
    const suggestions = suggestCoursesForNode(modules[0]!.children![0]!, courses, new Set(['M1']));
    expect(suggestions).toHaveLength(0);
  });
});
