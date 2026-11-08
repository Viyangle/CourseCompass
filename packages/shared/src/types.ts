/**
 * 领域模型：全站唯一的"结构化课表"表示。
 *
 * 设计原则
 * 1. 原始教务数据（ehall 返回的 JSON）永远先落成 RawSnapshot，再由适配器映射到这里的类型；
 *    模型不依赖任何具体学校的字段名。
 * 2. 前端与后端共用同一套类型与算法，保证"所见即所算"：界面上的冲突提示和
 *    后端返回的分析结果来自同一份代码。
 * 3. 所有个人数据都带来源与时间（provenance），因为 HCI 评测里"这条信息是哪一年的"
 *    本身就是研究问题的一部分。
 */

/* ------------------------------------------------------------------ */
/* 时间                                                                */
/* ------------------------------------------------------------------ */

/** 学期标识，形如 `2026-2027-2`。 */
export type TermId = string;

export interface Term {
  id: TermId;
  /** 展示名，例如「2026-2027学年 第二学期」 */
  name: string;
  /** 第 1 教学周的周一（ISO 8601，含时区偏移，如 2026-09-07） */
  startDate: string;
  /** 教学周总数，决定周课表的行数与冲突判定的上界 */
  weekCount: number;
  /** 是否为当前正在上的学期 */
  isCurrent?: boolean;
  /** 是否为本次规划的目标学期 */
  isPlanning?: boolean;
}

export type WeekParity = 'all' | 'odd' | 'even';

/**
 * 上课周次。
 * - 常规：`{ from: 3, to: 16, parity: 'all' }`
 * - 单周：`{ from: 3, to: 16, parity: 'odd' }`
 * - 跳周（如 1-8 周 + 10-16 周）：用 `explicit` 直接列出，优先级最高
 */
export interface WeekPattern {
  from: number;
  to: number;
  parity: WeekParity;
  /** 明确列出的周次，存在时忽略 from/to/parity */
  explicit?: number[];
}

/** 一段上课时间（一次"排课"）。 */
export interface Meeting {
  /** 1 = 周一 … 7 = 周日 */
  day: number;
  /** 起始节次，1 开始 */
  startPeriod: number;
  /** 结束节次，含 */
  endPeriod: number;
  weeks: WeekPattern;
  /** 展示用地点，如「仙林 仙II-203」 */
  location?: string;
  /** 校区，用于通勤提示 */
  campus?: string;
  /** 教学班备注，如「单周在实验室」 */
  remark?: string;
}

/** 一节课的作息配置；不同校区/学期可能不同，故做成数据而非常量。 */
export interface PeriodConfig {
  period: number;
  start: string;
  end: string;
}

/* ------------------------------------------------------------------ */
/* 课程与教学班                                                        */
/* ------------------------------------------------------------------ */

/** 归一化后的课程类别。原始类别文本保留在 `rawCategory`。 */
export type CourseCategory =
  | '通识通修'
  | '大类基础'
  | '专业准入'
  | '专业核心'
  | '专业选修'
  | '公共选修'
  | '实践环节'
  | '未分类';

export interface Course {
  /** 站内唯一 id（通常等于课程号） */
  id: string;
  /** 课程号，如 `22010010` */
  code: string;
  name: string;
  credits: number;
  /** 总学时，可选 */
  hours?: number;
  /** 开课院系 */
  department?: string;
  category: CourseCategory;
  /** 教务原始类别文本，便于溯源 */
  rawCategory?: string;
  /** 考核方式，如「闭卷考试」「论文」「考查」 */
  assessment?: string;
  /** 授课语言 */
  language?: string;
  /** 课程简介；来自教务描述，不做二次创作 */
  description?: string;
  /** 先修课程号 */
  prerequisites?: string[];
  /** 归一化标签，用于培养方案匹配（如「思政」「体育」「数学」） */
  tags?: string[];
  /** 数据来源标记 */
  source?: Provenance;
}

export interface Section {
  id: string;
  courseId: string;
  courseCode: string;
  termId: TermId;
  /** 教学班号，如 `01`、`3` */
  classNo: string;
  teachers: string[];
  /** 容量；-1 表示未知 */
  capacity?: number;
  /** 已选人数 */
  enrolled?: number;
  meetings: Meeting[];
  campus?: string;
  /** 选课备注，如「仅限本专业」「需自备电脑」 */
  note?: string;
  /** 该教学班是否已出现在学生当前课表中 */
  inCurrentTimetable?: boolean;
  source?: Provenance;
}

/* ------------------------------------------------------------------ */
/* 培养方案                                                            */
/* ------------------------------------------------------------------ */

export type RequirementRuleKind = 'courseSet' | 'tagSet' | 'elective';

export interface RequirementRule {
  kind: RequirementRuleKind;
  /** courseSet：明确指定的课程号集合 */
  courseCodes?: string[];
  /** tagSet：命中任一标签即可 */
  tags?: string[];
  /** elective：任意课程，可限制「不计入其他模块」 */
  allowOverflow?: boolean;
}

export interface RequirementNode {
  id: string;
  name: string;
  /** 该节点要求的学分；父节点通常等于子节点之和 */
  requiredCredits: number;
  /** 规则；父节点可无规则，仅做汇总 */
  rule?: RequirementRule;
  children?: RequirementNode[];
  /** 说明文本，来自培养方案原文 */
  note?: string;
  /** 是否允许把溢出的学分计入上层 */
  rollUpOverflow?: boolean;
}

export interface ProgramVersion {
  id: string;
  /** 如「2024版 计算机科学与技术 本科培养方案」 */
  name: string;
  major: string;
  /** 入学年级 */
  gradeYear: number;
  /** 毕业总学分要求 */
  totalCredits: number;
  /** 学制（年） */
  duration: number;
  modules: RequirementNode[];
  source?: Provenance;
}

/* ------------------------------------------------------------------ */
/* 学生与已修记录                                                      */
/* ------------------------------------------------------------------ */

export interface StudentProfile {
  studentId: string;
  name: string;
  /** 院系 / 大类 */
  college: string;
  major: string;
  gradeYear: number;
  programId: string;
  /** 是否为演示数据（用于全程角标） */
  demo: boolean;
}

export type TranscriptStatus = 'passed' | 'failed' | 'in-progress';

export interface TranscriptRecord {
  courseCode: string;
  courseName: string;
  credits: number;
  /** 百分制成绩；等级制可留空 */
  score?: number;
  /** 等级制成绩原文，如「优秀」 */
  gradeText?: string;
  gpa?: number;
  termId: TermId;
  category?: CourseCategory;
  rawCategory?: string;
  /** 归一化标签，由服务端用课程库补齐，用于培养方案匹配 */
  tags?: string[];
  status: TranscriptStatus;
  /** 实际获得学分；未通过为 0 */
  creditsEarned: number;
  /** 是否重修/补考 */
  retake?: boolean;
  source?: Provenance;
}

/* ------------------------------------------------------------------ */
/* 学业预警                                                            */
/* ------------------------------------------------------------------ */

export type WarningLevel = 'info' | 'warning' | 'serious';

export interface AcademicWarning {
  id: string;
  level: WarningLevel;
  title: string;
  detail: string;
  termId?: TermId;
  /** 涉及的课程号 */
  courseCodes?: string[];
  /** 触发规则的说明，便于解释"为什么提示" */
  rule?: string;
  source?: Provenance;
}

/* ------------------------------------------------------------------ */
/* 规划方案                                                            */
/* ------------------------------------------------------------------ */

export type PlanItemStatus = 'selected' | 'backup';

export interface PlanItem {
  id: string;
  sectionId: string;
  courseCode: string;
  status: PlanItemStatus;
  note?: string;
  addedAt: string;
  /** 加入来源，用于回答"我是从缺口列表里点的还是自己搜的" */
  origin?: 'pool' | 'requirement' | 'imported' | 'duplicate';
}

export interface Plan {
  id: string;
  name: string;
  termId: TermId;
  items: PlanItem[];
  note?: string;
  /** 展示色，用于多方案对比 */
  color?: string;
  createdAt: string;
  updatedAt: string;
}

/* ------------------------------------------------------------------ */
/* 分析结果                                                            */
/* ------------------------------------------------------------------ */

export type ConflictKind =
  | 'time'
  | 'duplicate-course'
  | 'already-passed'
  | 'credit-cap'
  | 'no-meeting'
  | 'campus-gap'
  | 'out-of-term'
  | 'requirement-unmapped';

export type Severity = 'error' | 'warning' | 'info';

export interface ConflictIssue {
  id: string;
  kind: ConflictKind;
  severity: Severity;
  /** 人话解释，直接用于界面展示 */
  message: string;
  /** 涉及的计划项 id */
  itemIds: string[];
  /** 涉及的时间段，用于课表格子高亮 */
  time?: {
    day: number;
    startPeriod: number;
    endPeriod: number;
    /** 共同冲突的周次 */
    weeks: number[];
  };
}

export interface RequirementProgress {
  nodeId: string;
  name: string;
  requiredCredits: number;
  /** 已修通过并计入本模块的学分 */
  earnedCredits: number;
  /** 计划中（尚未修读）的学分 */
  plannedCredits: number;
  /** 尚缺学分（不考虑计划） */
  remainingCredits: number;
  /** 缺口在计划中是否已被覆盖 */
  coveredByPlan: boolean;
  status: 'met' | 'planned' | 'short';
  /** 计入本模块的课程明细 */
  items: ProgressItem[];
  children?: RequirementProgress[];
}

export interface ProgressItem {
  courseCode: string;
  courseName: string;
  credits: number;
  from: 'transcript' | 'plan';
  /** 课程学分超过模块剩余要求时的溢出部分 */
  overflow?: number;
}

export interface ProgramProgress {
  programId: string;
  totalRequired: number;
  totalEarned: number;
  totalPlanned: number;
  totalRemaining: number;
  modules: RequirementProgress[];
  /** 未计入任何模块的课程（提醒用户"这门课可能不毕业要求"） */
  unmapped: { courseCode: string; courseName: string; credits: number; from: 'transcript' | 'plan' }[];
}

export interface PlanMetrics {
  totalCredits: number;
  backupCredits: number;
  courseCount: number;
  /** 每周平均课时（按 45/50 分钟一节的节次数） */
  weeklyPeriods: number;
  /** 需要到校的天数 */
  activeDays: number[];
  /** 最早开始节次 */
  earliestPeriod: number | null;
  /** 最晚结束节次 */
  latestPeriod: number | null;
  /** 课表中的空档节次数（同一到校日的最早晚之间没有课） */
  gapPeriods: number;
  /** 按星期统计的课时 */
  loadByDay: Record<number, number>;
  conflictCount: number;
  warningCount: number;
}

export interface PlanAnalysis {
  metrics: PlanMetrics;
  conflicts: ConflictIssue[];
  coverage: RequirementProgress[];
}

/** 多方案对比结果：指标 + 逐门课矩阵，前端直接渲染成对比表。 */
export interface PlanComparison {
  plans: {
    id: string;
    name: string;
    color?: string;
    metrics: PlanMetrics;
    coverage: RequirementProgress[];
  }[];
  courses: {
    courseCode: string;
    courseName: string;
    credits: number;
    /** 每个方案里的状态 */
    presence: Record<string, 'selected' | 'backup' | 'none'>;
    /** 每个方案里这门课涉及的冲突数 */
    conflictCount: Record<string, number>;
  }[];
}

/* ------------------------------------------------------------------ */
/* 数据来源                                                            */
/* ------------------------------------------------------------------ */

export type SourceKind = 'program' | 'transcript' | 'timetable' | 'warning' | 'catalog';
export type SourceMode = 'ehall' | 'manual' | 'mock';
export type SourceStatus = 'ok' | 'stale' | 'error' | 'pending';

export interface Provenance {
  kind: SourceKind;
  mode: SourceMode;
  /** ISO 时间戳 */
  fetchedAt: string;
  /** 原始页面/接口地址，便于用户核对 */
  url?: string;
}

export interface SourceRecord {
  kind: SourceKind;
  label: string;
  mode: SourceMode;
  status: SourceStatus;
  fetchedAt?: string;
  /** 覆盖的学期范围 */
  termRange?: string;
  detail?: string;
  url?: string;
  /** 该来源贡献的记录数 */
  records?: number;
}

/* ------------------------------------------------------------------ */
/* 会话与接口信封                                                      */
/* ------------------------------------------------------------------ */

export type AuthMethod = 'demo' | 'cas' | 'cookie';

export interface SessionInfo {
  authenticated: boolean;
  method?: AuthMethod;
  profile?: StudentProfile;
  /** CAS 会话剩余有效秒数 */
  expiresIn?: number;
  /** 是否处于离线/模拟数据模式 */
  offline: boolean;
}

export interface ApiOk<T> {
  ok: true;
  data: T;
}

export interface ApiErr {
  ok: false;
  error: {
    code: string;
    message: string;
    /** 面向开发者的补充信息，不展示给学生 */
    details?: unknown;
  };
}

export type ApiResult<T> = ApiOk<T> | ApiErr;

/* ------------------------------------------------------------------ */
/* 前端引导数据                                                        */
/* ------------------------------------------------------------------ */

export interface BootstrapData {
  session: SessionInfo;
  terms: Term[];
  currentTermId: TermId;
  planningTermId: TermId;
  periods: PeriodConfig[];
  profile: StudentProfile;
  program: ProgramVersion;
  transcript: TranscriptRecord[];
  warnings: AcademicWarning[];
  plans: Plan[];
  sources: SourceRecord[];
  /** 课程库版本，用于前端缓存失效 */
  catalogVersion: string;
}

export interface CourseQuery {
  termId?: TermId;
  q?: string;
  category?: CourseCategory | 'all';
  department?: string;
  minCredits?: number;
  maxCredits?: number;
  /** 只在某天有课 */
  weekday?: number;
  /** 与某个方案的已选课程无冲突 */
  noConflictWith?: string;
  /** 只显示能补足培养方案缺口的课程 */
  onlyGaps?: boolean;
  page?: number;
  pageSize?: number;
  sort?: 'relevance' | 'credits-asc' | 'credits-desc' | 'code';
}

export interface CourseQueryResult {
  items: CourseWithSections[];
  total: number;
  page: number;
  pageSize: number;
  /** 命中缺口的课程号（用于角标） */
  gapCourseCodes: string[];
}

export interface CourseWithSections {
  course: Course;
  sections: Section[];
  /** 该课程覆盖了哪些培养方案节点 */
  requirementIds: string[];
  /** 该课程的课表状态 */
  state: 'available' | 'in-plan' | 'passed' | 'in-current-timetable' | 'conflict';
}
