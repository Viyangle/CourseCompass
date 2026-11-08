import type {
  AcademicWarning,
  Course,
  CourseCategory,
  Plan,
  PeriodConfig,
  ProgramVersion,
  Section,
  SourceRecord,
  StudentProfile,
  Term,
  TranscriptRecord,
} from '@planner/shared';

/** 本地库的磁盘结构。刻意保持扁平，方便演示、备份和人工核对。 */
export interface Db {
  version: number;
  profile: StudentProfile;
  terms: Term[];
  periods: PeriodConfig[];
  courses: Course[];
  sections: Section[];
  program: ProgramVersion;
  transcript: TranscriptRecord[];
  warnings: AcademicWarning[];
  plans: Plan[];
  sources: SourceRecord[];
  settings: {
    currentTermId: string;
    planningTermId: string;
    creditCap: number;
    /** 培养方案核算口径的说明，展示给学生看 */
    allocationPolicy: string;
  };
  /** 原始抓取快照索引：文件名 + 来源 + 时间，便于溯源 */
  rawSnapshots: { id: string; kind: string; file: string; capturedAt: string; url?: string }[];
}

export type { CourseCategory };
