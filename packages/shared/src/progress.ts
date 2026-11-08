/**
 * 培养方案核算：把「已修 + 在修 + 计划」映射到培养方案的各个模块。
 *
 * 这里有一个所有同类工具都绕不开的问题：**一门课到底算进哪个模块？**
 * 教务系统的真实规则往往带"就高/就低""优先必修"等隐藏优先级，且各院系不同。
 * 本项目采用一条可解释的、用户可见的规则，而不是假装知道学校的精确规则：
 *
 *   1. 越具体的规则优先级越高：指定课程清单 > 标签集合 > 任意选修；
 *   2. 同一优先级内按培养方案的书写顺序；
 *   3. 一门课只计入一个模块（避免同一学分被算两遍）；
 *   4. 模块修满后仍可继续计入，但界面标为「溢出」，提醒用户不必再选。
 *
 * 规则是可见的（界面上有一行说明），因此即使与学校口径有差异，用户也能自己判断。
 */

import type {
  Course,
  Plan,
  ProgramProgress,
  ProgramVersion,
  ProgressItem,
  RequirementNode,
  RequirementProgress,
  RequirementRule,
  Section,
  TranscriptRecord,
} from './types.js';

export interface ProgressInput {
  program: ProgramVersion;
  transcript: TranscriptRecord[];
  /** 计划中 / 在修中的课程（尚未获得学分） */
  planned: { courseCode: string; courseName: string; credits: number; tags?: string[] }[];
  /** 可选的课程库：用于补齐成绩记录里缺失的标签（教务导出的成绩单通常没有标签） */
  courses?: Course[];
}

/**
 * 从「成绩单 + 方案 + 课程库」推导出"在修 + 计划中"的课程。
 * 前后端共用同一份推导逻辑，避免出现"后端说已覆盖、界面说还差 4 学分"这种自相矛盾。
 */
export function collectPlannedCourses(input: {
  transcript: TranscriptRecord[];
  plan?: Plan;
  sections: Section[];
  courses: Course[];
}): ProgressInput['planned'] {
  const courseByCode = new Map(input.courses.map((course) => [course.code, course]));
  const sectionById = new Map(input.sections.map((section) => [section.id, section]));

  const inProgress = input.transcript
    .filter((record) => record.status === 'in-progress')
    .map((record) => ({
      courseCode: record.courseCode,
      courseName: record.courseName,
      credits: record.credits,
      tags: courseByCode.get(record.courseCode)?.tags ?? record.tags,
    }));

  const planned =
    input.plan?.items
      .filter((item) => item.status === 'selected')
      .map((item) => {
        const section = sectionById.get(item.sectionId);
        const course = section ? courseByCode.get(section.courseCode) : undefined;
        if (!course) return null;
        return {
          courseCode: course.code,
          courseName: course.name,
          credits: course.credits,
          tags: course.tags,
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null) ?? [];

  // 在修课程已经由成绩单（status=in-progress）带进来；如果方案里又选了同一门课，
  // 只能算一次，否则「计划学分」会翻倍。
  const inProgressCodes = new Set(inProgress.map((item) => item.courseCode));
  return [...inProgress, ...planned.filter((item) => !inProgressCodes.has(item.courseCode))];
}

interface AllocCourse {
  courseCode: string;
  courseName: string;
  credits: number;
  tags?: string[];
  from: 'transcript' | 'plan';
}

export function ruleSpecificity(rule: RequirementRule): number {
  switch (rule.kind) {
    case 'courseSet':
      return 0;
    case 'tagSet':
      return 1;
    default:
      return 2;
  }
}

export function matchesRule(rule: RequirementRule, course: { code?: string; courseCode?: string; tags?: string[] }): boolean {
  const code = course.courseCode ?? course.code ?? '';
  const tags = course.tags ?? [];
  switch (rule.kind) {
    case 'courseSet':
      return (rule.courseCodes ?? []).includes(code);
    case 'tagSet':
      return (rule.tags ?? []).some((tag) => tags.includes(tag));
    case 'elective':
      return true;
    default:
      return false;
  }
}

/** 展平培养方案：只保留带规则的叶子节点，并保留可读路径。 */
export function flattenRequirements(
  nodes: RequirementNode[],
  path: string[] = [],
): { node: RequirementNode; path: string[] }[] {
  const out: { node: RequirementNode; path: string[] }[] = [];
  for (const node of nodes) {
    const nextPath = [...path, node.name];
    if (node.children && node.children.length > 0) {
      out.push(...flattenRequirements(node.children, nextPath));
    } else if (node.rule) {
      out.push({ node, path: nextPath });
    }
  }
  return out;
}

/**
 * 课程 → 覆盖的模块 id 列表。
 * 用于：课程卡片角标、课时"是否计入毕业要求"的提示、缺口筛选。
 */
export function buildCourseRequirementIndex(program: ProgramVersion): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const { node } of flattenRequirements(program.modules)) {
    const rule = node.rule;
    if (!rule) continue;
    if (rule.kind === 'courseSet') {
      for (const code of rule.courseCodes ?? []) {
        const list = index.get(code) ?? [];
        if (!list.includes(node.id)) list.push(node.id);
        index.set(code, list);
      }
    }
  }
  return index;
}

/** 标签 → 模块 id，供课程库按标签反查（课程只有标签时使用）。 */
export function buildTagRequirementIndex(program: ProgramVersion): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const { node } of flattenRequirements(program.modules)) {
    const rule = node.rule;
    if (!rule || rule.kind !== 'tagSet') continue;
    for (const tag of rule.tags ?? []) {
      const list = index.get(tag) ?? [];
      if (!list.includes(node.id)) list.push(node.id);
      index.set(tag, list);
    }
  }
  return index;
}

export function resolveCourseRequirementIds(program: ProgramVersion, course: Course): string[] {
  const ids = new Set<string>();
  for (const { node } of flattenRequirements(program.modules)) {
    if (node.rule && matchesRule(node.rule, { courseCode: course.code, tags: course.tags })) {
      ids.add(node.id);
    }
  }
  return [...ids];
}

/**
 * 课程号 → 覆盖模块 id。
 * 必须结合课程对象才能正确处理标签规则，所以这里需要课程库；
 * 只按 courseSet 建索引会把所有"标签型"课程误判为"不计入毕业要求"。
 */
export function buildRequirementIndex(program: ProgramVersion, courses: Course[]): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const course of courses) {
    const ids = resolveCourseRequirementIds(program, course);
    if (ids.length > 0) index.set(course.code, ids);
  }
  return index;
}

function collectCourses(input: ProgressInput): AllocCourse[] {
  const coursesIndex = input.courses ? new Map(input.courses.map((course) => [course.code, course])) : undefined;
  const transcript = input.transcript
    .filter((r) => r.status === 'passed' && r.creditsEarned > 0)
    .map((record) => {
      if (record.tags && record.tags.length > 0) return record;
      const tags = coursesIndex?.get(record.courseCode)?.tags;
      return tags ? { ...record, tags } : record;
    });
  // 只有"已通过"才占用课程号；在修课程要保留在 planned 里，否则它们既不算已修也不算计划，
  // 会让"专业核心 0/16"这类显示明显偏低。
  const occupied = new Set(
    input.transcript.filter((r) => r.status === 'passed').map((r) => r.courseCode),
  );
  const courses: AllocCourse[] = transcript.map((r) => ({
    courseCode: r.courseCode,
    courseName: r.courseName,
    credits: r.creditsEarned,
    tags: r.tags,
    from: 'transcript' as const,
  }));
  for (const plan of input.planned) {
    if (occupied.has(plan.courseCode)) continue;
    courses.push({
      courseCode: plan.courseCode,
      courseName: plan.courseName,
      credits: plan.credits,
      tags: plan.tags,
      from: 'plan',
    });
  }
  return courses;
}

interface MutableProgress {
  node: RequirementNode;
  earned: number;
  planned: number;
  items: ProgressItem[];
}

export function computeProgramProgress(input: ProgressInput): ProgramProgress {
  const leaves = flattenRequirements(input.program.modules);
  const sorted = [...leaves].sort((a, b) => {
    const diff = ruleSpecificity(a.node.rule!) - ruleSpecificity(b.node.rule!);
    if (diff !== 0) return diff;
    return leaves.indexOf(a) - leaves.indexOf(b);
  });

  const state = new Map<string, MutableProgress>();
  for (const { node } of sorted) {
    state.set(node.id, { node, earned: 0, planned: 0, items: [] });
  }

  const courses = collectCourses(input);
  // 已修优先分配，其次按学分从大到小，减少"小课占位"导致的溢出
  courses.sort((a, b) => {
    if (a.from !== b.from) return a.from === 'transcript' ? -1 : 1;
    return b.credits - a.credits;
  });

  const unmapped: ProgramProgress['unmapped'] = [];

  for (const course of courses) {
    const target = sorted.find(({ node }) => {
      const rule = node.rule!;
      if (!matchesRule(rule, { courseCode: course.courseCode, tags: course.tags })) return false;
      const current = state.get(node.id)!;
      return current.earned + current.planned < node.requiredCredits;
    });

    const fallback = target ?? sorted.find(({ node }) => matchesRule(node.rule!, { courseCode: course.courseCode, tags: course.tags }));
    if (!fallback) {
      unmapped.push({
        courseCode: course.courseCode,
        courseName: course.courseName,
        credits: course.credits,
        from: course.from,
      });
      continue;
    }

    const targetState = state.get(fallback.node.id)!;
    const covered = targetState.earned + targetState.planned;
    const overflow = Math.max(0, covered + course.credits - fallback.node.requiredCredits);
    if (course.from === 'transcript') targetState.earned += course.credits;
    else targetState.planned += course.credits;

    targetState.items.push({
      courseCode: course.courseCode,
      courseName: course.courseName,
      credits: course.credits,
      from: course.from,
      overflow: overflow > 0 ? overflow : undefined,
    });
  }

  const buildNode = (node: RequirementNode): RequirementProgress => {
    if (node.children && node.children.length > 0) {
      const children = node.children.map(buildNode);
      const earned = children.reduce((sum, c) => sum + c.earnedCredits, 0);
      const planned = children.reduce((sum, c) => sum + c.plannedCredits, 0);
      const required = node.requiredCredits || children.reduce((sum, c) => sum + c.requiredCredits, 0);
      const remaining = Math.max(0, required - earned);
      return {
        nodeId: node.id,
        name: node.name,
        requiredCredits: required,
        earnedCredits: earned,
        plannedCredits: planned,
        remainingCredits: remaining,
        coveredByPlan: earned + planned >= required,
        status: earned >= required ? 'met' : earned + planned >= required ? 'planned' : 'short',
        items: [],
        children,
      };
    }

    const current = state.get(node.id)!;
    const required = node.requiredCredits;
    const remaining = Math.max(0, required - current.earned);
    return {
      nodeId: node.id,
      name: node.name,
      requiredCredits: required,
      earnedCredits: current.earned,
      plannedCredits: current.planned,
      remainingCredits: remaining,
      coveredByPlan: current.earned + current.planned >= required,
      status: current.earned >= required ? 'met' : current.earned + current.planned >= required ? 'planned' : 'short',
      items: current.items,
    };
  };

  const modules = input.program.modules.map(buildNode);
  const totalEarned = modules.reduce((sum, m) => sum + m.earnedCredits, 0);
  const totalPlanned = modules.reduce((sum, m) => sum + m.plannedCredits, 0);
  const totalRequired = input.program.totalCredits || modules.reduce((sum, m) => sum + m.requiredCredits, 0);

  return {
    programId: input.program.id,
    totalRequired,
    totalEarned,
    totalPlanned,
    totalRemaining: Math.max(0, totalRequired - totalEarned),
    modules,
    unmapped,
  };
}

/** 找到某个节点的进度（含层级查找）。 */
export function findProgress(modules: RequirementProgress[], nodeId: string): RequirementProgress | undefined {
  for (const module of modules) {
    if (module.nodeId === nodeId) return module;
    if (module.children) {
      const found = findProgress(module.children, nodeId);
      if (found) return found;
    }
  }
  return undefined;
}

/**
 * 为某个缺口模块推荐课程：命中规则、未修读、未在计划中。
 * 只做"候选"，具体选哪个由用户决定。
 */
export function suggestCoursesForNode(
  node: RequirementNode,
  catalog: Course[],
  excludedCodes: Set<string>,
): Course[] {
  if (!node.rule) return [];
  return catalog.filter((course) => {
    if (excludedCodes.has(course.code)) return false;
    return matchesRule(node.rule!, { courseCode: course.code, tags: course.tags });
  });
}
