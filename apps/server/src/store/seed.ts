/**
 * 演示数据（脱敏）。
 *
 * 这份数据不是随便编的：它刻意覆盖了产品必须处理的边界情况——
 * - 单周/双周课程（数据伦理只在单周上、与全周课程在周五 5-6 节重叠）；
 * - 同一门课的两个教学班在不同时间（编译原理 01/02）；
 * - 两个模块都能算的课程（人工智能导论同时带"专业核心选修"标签）；
 * - 没有排课时间的课程（学术写作与沟通，线上）；
 * - 已经修过却在计划里重复出现（若用户误加）；
 * - 在修课程（status = in-progress，不能当已获学分）。
 *
 * 真实数据接入后，这份种子只用于「演示模式」与自动化测试。
 */

import type {
  AcademicWarning,
  Course,
  CourseCategory,
  Plan,
  ProgramVersion,
  Section,
  SourceRecord,
  Term,
  TranscriptRecord,
  WeekParity,
} from '@planner/shared';
import { DEFAULT_PERIODS } from '@planner/shared';
import type { Db } from './types.js';

const TERMS: Term[] = [
  { id: '2024-2025-1', name: '2024-2025学年 第一学期', startDate: '2024-09-02', weekCount: 20 },
  { id: '2024-2025-2', name: '2024-2025学年 第二学期', startDate: '2025-02-17', weekCount: 20 },
  { id: '2025-2026-1', name: '2025-2026学年 第一学期', startDate: '2025-09-01', weekCount: 20 },
  { id: '2025-2026-2', name: '2025-2026学年 第二学期', startDate: '2026-02-23', weekCount: 20 },
  { id: '2026-2027-1', name: '2026-2027学年 第一学期', startDate: '2026-09-07', weekCount: 20, isCurrent: true },
  { id: '2026-2027-2', name: '2026-2027学年 第二学期', startDate: '2027-02-22', weekCount: 20, isPlanning: true },
];

const CURRENT_TERM = '2026-2027-1';
const PLANNING_TERM = '2026-2027-2';

type MeetingSeed = [
  day: number,
  startPeriod: number,
  endPeriod: number,
  parity?: WeekParity,
  location?: string,
];

interface SectionSeed {
  classNo: string;
  teachers: string[];
  meetings: MeetingSeed[];
  campus?: string;
  note?: string;
}

interface TakenSeed {
  termId: string;
  score?: number;
  status?: 'passed' | 'failed' | 'in-progress';
}

interface CourseSeed {
  code: string;
  name: string;
  credits: number;
  category: CourseCategory;
  tags: string[];
  assessment: string;
  department: string;
  description?: string;
  taken?: TakenSeed;
  /** 规划学期开课 */
  offer?: SectionSeed[];
  /** 当前学期课表 */
  current?: SectionSeed[];
}

const C = (
  code: string,
  name: string,
  credits: number,
  category: CourseCategory,
  tags: string[],
  assessment: string,
  department: string,
  rest: Partial<CourseSeed> = {},
): CourseSeed => ({ code, name, credits, category, tags, assessment, department, ...rest });

const COURSES: CourseSeed[] = [
  /* ---------- 思政 ---------- */
  C('MARX1001', '思想道德与法治', 3, '通识通修', ['思政'], '闭卷考试', '马克思主义学院', {
    taken: { termId: '2024-2025-1', score: 88 },
    description: '围绕人生观、价值观、法治观展开，含小组讨论与课程论文。',
  }),
  C('MARX1002', '中国近现代史纲要', 3, '通识通修', ['思政'], '闭卷考试', '马克思主义学院', {
    taken: { termId: '2024-2025-2', score: 85 },
  }),
  C('MARX1003', '马克思主义基本原理', 3, '通识通修', ['思政'], '闭卷考试', '马克思主义学院', {
    taken: { termId: '2025-2026-1', score: 82 },
  }),
  C('MARX1004', '毛泽东思想和中国特色社会主义理论体系概论', 3, '通识通修', ['思政'], '课程论文', '马克思主义学院', {
    taken: { termId: '2025-2026-2', score: 90 },
  }),
  C('MARX1005', '习近平新时代中国特色社会主义思想概论', 3, '通识通修', ['思政'], '课程论文', '马克思主义学院', {
    taken: { termId: CURRENT_TERM, status: 'in-progress' },
    current: [{ classNo: '01', teachers: ['王建华'], meetings: [[1, 1, 2, 'all', '仙林 仙I-201']], campus: '仙林' }],
  }),

  /* ---------- 外语 ---------- */
  C('ENG1001', '大学英语（一）', 2, '通识通修', ['外语'], '机考', '大学外语部', {
    taken: { termId: '2024-2025-1', score: 86 },
  }),
  C('ENG1002', '大学英语（二）', 2, '通识通修', ['外语'], '机考', '大学外语部', {
    taken: { termId: '2024-2025-2', score: 84 },
  }),
  C('ENG1003', '大学英语（三）', 2, '通识通修', ['外语'], '机考', '大学外语部', {
    taken: { termId: '2025-2026-1', score: 81 },
  }),
  C('ENG1004', '学术英语写作', 2, '通识通修', ['外语'], '课程论文', '大学外语部', {
    taken: { termId: '2025-2026-2', score: 89 },
  }),

  /* ---------- 体育 ---------- */
  C('PE1001', '体育（一）', 1, '通识通修', ['体育'], '技能考核', '体育部', {
    taken: { termId: '2024-2025-1', score: 90 },
  }),
  C('PE1002', '体育（二）', 1, '通识通修', ['体育'], '技能考核', '体育部', {
    taken: { termId: '2024-2025-2', score: 88 },
  }),
  C('PE1003', '体育（三）', 1, '通识通修', ['体育'], '技能考核', '体育部', {
    taken: { termId: '2025-2026-1', score: 85 },
  }),
  C('PE1004', '体育（四）', 1, '通识通修', ['体育'], '技能考核', '体育部', {
    taken: { termId: CURRENT_TERM, status: 'in-progress' },
    current: [{ classNo: '07', teachers: ['陈磊'], meetings: [[3, 7, 8, 'all', '仙林 体育馆']], campus: '仙林' }],
  }),

  /* ---------- 通识 ---------- */
  C('GEN1001', '心理学导论', 2, '通识通修', ['通识'], '开卷考试', '社会学院', {
    taken: { termId: '2024-2025-2', score: 92 },
  }),
  C('GEN1002', '中国传统文化概论', 2, '通识通修', ['通识'], '课程论文', '文学院', {
    taken: { termId: '2025-2026-1', score: 87 },
  }),
  C('GEN1003', '艺术与审美', 2, '通识通修', ['通识'], '作品+论文', '艺术学院', {
    taken: { termId: '2025-2026-2', score: 93 },
  }),
  C('GEN2001', '科技与社会', 2, '通识通修', ['通识'], '课程论文', '哲学系', {
    description: '讨论技术变迁与社会结构的关系，考核为一篇 4000 字课程论文。',
    offer: [
      {
        classNo: '01',
        teachers: ['刘云'],
        meetings: [
          [2, 9, 10, 'all', '仙林 仙II-105'],
          [5, 5, 6, 'all', '仙林 仙II-105'],
        ],
        campus: '仙林',
        note: '期末课程论文，无闭卷考试',
      },
    ],
  }),
  C('GEN2002', '西方哲学史', 2, '通识通修', ['通识'], '闭卷考试', '哲学系', {
    offer: [{ classNo: '01', teachers: ['赵敏'], meetings: [[4, 7, 8, 'all', '仙林 仙I-402']], campus: '仙林' }],
  }),
  C('GEN2003', '数据伦理', 2, '通识通修', ['通识'], '课程论文', '哲学系', {
    description: '只在前 8 周单周上课，讨论隐私、算法公平与责任归属。',
    offer: [
      {
        classNo: '01',
        teachers: ['孙可'],
        meetings: [[5, 5, 6, 'odd', '仙林 仙II-208']],
        campus: '仙林',
        note: '1-15 周单周上课',
      },
    ],
  }),
  C('GEN2004', '学术写作与沟通', 1, '通识通修', ['通识'], '课程论文', '本科生院', {
    description: '线上课程，无固定上课时间，按周提交作业。',
    offer: [{ classNo: '01', teachers: ['周宁'], meetings: [], campus: '线上', note: '纯线上，无固定时段' }],
  }),

  /* ---------- 新生研讨与军事 ---------- */
  C('NEW1001', '新生研讨课', 1, '通识通修', ['新生'], '课堂参与', '计算机学院', {
    taken: { termId: '2024-2025-1', score: 95 },
  }),
  C('MIL1001', '军事理论', 2, '通识通修', ['军事'], '闭卷考试', '人武部', {
    taken: { termId: '2024-2025-1', score: 91 },
  }),
  C('MIL1002', '军事技能训练', 2, '通识通修', ['军事'], '技能考核', '人武部', {
    taken: { termId: '2024-2025-1', score: 90 },
  }),

  /* ---------- 数学 ---------- */
  C('MATH1001', '高等数学（一）', 5, '大类基础', ['数学'], '闭卷考试', '数学系', {
    taken: { termId: '2024-2025-1', score: 84 },
  }),
  C('MATH1002', '高等数学（二）', 5, '大类基础', ['数学'], '闭卷考试', '数学系', {
    taken: { termId: '2024-2025-2', score: 78 },
  }),
  C('MATH1003', '线性代数', 3, '大类基础', ['数学'], '闭卷考试', '数学系', {
    taken: { termId: '2024-2025-2', score: 86 },
  }),
  C('MATH1004', '概率论与数理统计', 3, '大类基础', ['数学'], '闭卷考试', '数学系', {
    taken: { termId: '2025-2026-1', score: 81 },
  }),

  /* ---------- 物理 ---------- */
  C('PHY1001', '大学物理（一）', 4, '大类基础', ['物理'], '闭卷考试', '物理学院', {
    taken: { termId: '2024-2025-2', score: 80 },
  }),
  C('PHY1002', '大学物理（二）', 4, '大类基础', ['物理'], '闭卷考试', '物理学院', {
    taken: { termId: '2025-2026-1', score: 76 },
  }),
  C('PHY1003', '大学物理实验', 2, '大类基础', ['物理'], '实验报告', '物理学院', {
    taken: { termId: '2025-2026-1', score: 88 },
  }),

  /* ---------- 计算基础（指定课程） ---------- */
  C('CS101', '程序设计基础', 3, '大类基础', ['计算基础'], '机考+作业', '计算机学院', {
    taken: { termId: '2024-2025-1', score: 89 },
  }),
  C('CS102', '计算机系统导论', 3, '大类基础', ['计算基础'], '闭卷考试', '计算机学院', {
    taken: { termId: '2024-2025-2', score: 85 },
  }),

  /* ---------- 专业准入 ---------- */
  C('CS201', '数据结构', 4, '专业准入', ['准入必修'], '闭卷考试+实验', '计算机学院', {
    taken: { termId: '2024-2025-2', score: 83 },
  }),
  C('CS202', '离散数学', 4, '专业准入', ['准入必修'], '闭卷考试', '计算机学院', {
    taken: { termId: '2024-2025-2', score: 79 },
  }),
  C('CS203', '计算机组成原理', 4, '专业准入', ['准入必修'], '闭卷考试+实验', '计算机学院', {
    taken: { termId: '2025-2026-1', score: 81 },
  }),
  C('CS210', '面向对象程序设计', 3, '专业准入', ['专业准入'], '项目+考试', '计算机学院', {
    taken: { termId: '2025-2026-1', score: 90 },
  }),
  C('CS211', '算法设计与分析', 3, '专业准入', ['专业准入'], '闭卷考试', '计算机学院', {
    taken: { termId: '2025-2026-2', score: 87 },
  }),
  C('CS212', '软件工程导论', 2, '专业准入', ['专业准入'], '项目答辩', '计算机学院', {
    description: '小组项目制，组队 4-5 人，期末做一次公开答辩。',
    offer: [{ classNo: '01', teachers: ['郑好'], meetings: [[2, 7, 8, 'all', '仙林 仙II-301']], campus: '仙林' }],
  }),

  /* ---------- 专业核心 ---------- */
  C('CS301', '操作系统', 4, '专业核心', ['核心必修'], '闭卷考试+实验', '计算机学院', {
    taken: { termId: CURRENT_TERM, status: 'in-progress' },
    current: [
      {
        classNo: '01',
        teachers: ['吴强'],
        meetings: [
          [2, 3, 4, 'all', '仙林 仙II-210'],
          [4, 3, 4, 'all', '仙林 仙II-210'],
        ],
        campus: '仙林',
      },
    ],
  }),
  C('CS302', '计算机网络', 4, '专业核心', ['核心必修'], '闭卷考试+实验', '计算机学院', {
    taken: { termId: CURRENT_TERM, status: 'in-progress' },
    current: [{ classNo: '02', teachers: ['黄颖'], meetings: [[1, 5, 6, 'all', '仙林 仙I-308']], campus: '仙林' }],
  }),
  C('CS303', '数据库系统', 4, '专业核心', ['核心必修'], '项目+考试', '计算机学院', {
    taken: { termId: CURRENT_TERM, status: 'in-progress' },
    current: [
      {
        classNo: '01',
        teachers: ['林涛'],
        meetings: [
          [3, 1, 2, 'all', '仙林 仙I-105'],
          [5, 1, 2, 'all', '仙林 仙I-105'],
        ],
        campus: '仙林',
      },
    ],
  }),
  C('CS304', '编译原理', 4, '专业核心', ['核心必修'], '闭卷考试+实验', '计算机学院', {
    description: '实现一个能跑通的小型编译器前端，实验量较大。',
    offer: [
      {
        classNo: '01',
        teachers: ['张伟'],
        meetings: [
          [1, 3, 4, 'all', '仙林 仙I-210'],
          [3, 3, 4, 'all', '仙林 仙I-210'],
        ],
        campus: '仙林',
      },
      {
        classNo: '02',
        teachers: ['李静'],
        meetings: [
          [2, 3, 4, 'all', '仙林 仙I-315'],
          [4, 3, 4, 'all', '仙林 仙I-315'],
        ],
        campus: '仙林',
        note: '与 01 班内容相同，实验课单独安排',
      },
    ],
  }),
  C('CS305', '计算机体系结构', 4, '专业核心', ['核心必修'], '闭卷考试', '计算机学院', {
    offer: [{ classNo: '01', teachers: ['徐峰'], meetings: [[2, 5, 6, 'all', '仙林 仙II-404'], [4, 5, 6, 'all', '仙林 仙II-404']], campus: '仙林' }],
  }),
  C('CS320', '人工智能导论', 3, '专业核心', ['专业核心选修'], '项目+考试', '人工智能学院', {
    taken: { termId: '2025-2026-2', score: 91 },
  }),
  C('CS321', '计算机图形学', 3, '专业核心', ['专业核心选修'], '项目', '计算机学院', {
    offer: [{ classNo: '01', teachers: ['何静'], meetings: [[2, 1, 2, 'all', '仙林 仙II-108'], [4, 1, 2, 'all', '仙林 仙II-108']], campus: '仙林' }],
  }),
  C('CS322', '分布式系统', 3, '专业核心', ['专业核心选修'], '项目+考试', '计算机学院', {
    description: '以论文阅读和一个小型分布式存储项目为主。',
    offer: [{ classNo: '01', teachers: ['王浩'], meetings: [[1, 3, 4, 'all', '仙林 仙II-306'], [3, 5, 6, 'all', '仙林 仙II-306']], campus: '仙林' }],
  }),
  C('CS323', '模式识别', 2, '专业核心', ['专业核心选修'], '项目', '人工智能学院', {
    offer: [{ classNo: '01', teachers: ['许晴'], meetings: [[4, 3, 4, 'all', '仙林 仙I-220']], campus: '仙林' }],
  }),

  /* ---------- 专业选修 ---------- */
  C('CS330', '机器学习', 3, '专业选修', ['专业选修'], '项目+考试', '人工智能学院', {
    taken: { termId: '2025-2026-2', score: 89 },
  }),
  C('CS331', 'Web 开发技术', 3, '专业选修', ['专业选修'], '项目', '计算机学院', {
    taken: { termId: '2025-2026-2', score: 94 },
  }),
  C('CS332', '数据挖掘', 3, '专业选修', ['专业选修'], '项目+考试', '计算机学院', {
    offer: [{ classNo: '01', teachers: ['钱多'], meetings: [[3, 5, 6, 'all', '仙林 仙II-115']], campus: '仙林' }],
  }),
  C('CS333', '自然语言处理', 3, '专业选修', ['专业选修'], '项目', '人工智能学院', {
    offer: [{ classNo: '01', teachers: ['顾言'], meetings: [[3, 7, 8, 'all', '仙林 仙II-212']], campus: '仙林' }],
  }),
  C('CS334', '人机交互', 3, '专业选修', ['专业选修'], '项目+论文', '计算机学院', {
    description: '以用户研究与可用性测试为主线，工作量集中在期末项目。',
    offer: [{ classNo: '01', teachers: ['沈一'], meetings: [[5, 3, 4, 'all', '仙林 仙I-118']], campus: '仙林' }],
  }),
  C('CS335', '移动应用开发', 2, '专业选修', ['专业选修'], '项目', '计算机学院', {
    offer: [{ classNo: '01', teachers: ['杨帆'], meetings: [[5, 7, 8, 'all', '仙林 仙II-401']], campus: '仙林' }],
  }),
  C('CS336', '云计算', 2, '专业选修', ['专业选修'], '项目', '计算机学院', {
    offer: [{ classNo: '01', teachers: ['唐宁'], meetings: [[1, 7, 8, 'all', '仙林 仙I-502']], campus: '仙林' }],
  }),
  C('CS337', '信息安全导论', 2, '专业选修', ['专业选修'], '闭卷考试', '计算机学院', {
    offer: [{ classNo: '01', teachers: ['冯锐'], meetings: [[1, 1, 2, 'all', '仙林 仙II-203']], campus: '仙林' }],
  }),

  /* ---------- 实践环节 ---------- */
  C('CS401', '程序设计实验', 2, '实践环节', ['实验'], '实验报告', '计算机学院', {
    taken: { termId: '2024-2025-1', score: 92 },
  }),
  C('CS402', '数据结构实验', 2, '实践环节', ['实验'], '实验报告', '计算机学院', {
    taken: { termId: '2024-2025-2', score: 90 },
  }),
  C('CS403', '操作系统实验', 3, '实践环节', ['实验'], '实验报告', '计算机学院', {
    taken: { termId: '2025-2026-2', score: 88 },
  }),
  C('CS404', '计算机网络实验', 3, '实践环节', ['实验'], '实验报告', '计算机学院', {
    taken: { termId: '2025-2026-2', score: 86 },
  }),
  C('CS410', '生产实习', 4, '实践环节', ['实习'], '实习报告', '计算机学院', {
    description: '暑期 6-8 周企业实习，需提交实习报告与单位鉴定。',
  }),
  C('CS420', '毕业论文', 8, '实践环节', ['毕业设计'], '论文答辩', '计算机学院', {
    description: '大四下学期完成，需通过开题、中期与答辩三个环节。',
  }),
];

function buildProgram(): ProgramVersion {
  return {
    id: 'prog-cs-2024',
    name: '2024版 计算机科学与技术 本科培养方案',
    major: '计算机科学与技术',
    gradeYear: 2024,
    totalCredits: 159,
    duration: 4,
    modules: [
      {
        id: 'g-general',
        name: '通识通修课程',
        requiredCredits: 45,
        children: [
          {
            id: 'g-general-politics',
            name: '思想政治理论',
            requiredCredits: 16,
            rule: { kind: 'tagSet', tags: ['思政'] },
            note: '含习近平新时代中国特色社会主义思想概论（3 学分）',
          },
          { id: 'g-general-english', name: '外语能力', requiredCredits: 8, rule: { kind: 'tagSet', tags: ['外语'] } },
          { id: 'g-general-pe', name: '体育与健康', requiredCredits: 4, rule: { kind: 'tagSet', tags: ['体育'] } },
          { id: 'g-general-liberal', name: '通识教育', requiredCredits: 12, rule: { kind: 'tagSet', tags: ['通识'] } },
          { id: 'g-general-newbie', name: '新生研讨与军事', requiredCredits: 5, rule: { kind: 'tagSet', tags: ['新生', '军事'] } },
        ],
      },
      {
        id: 'g-foundation',
        name: '大类基础课程',
        requiredCredits: 32,
        children: [
          { id: 'g-foundation-math', name: '数学基础', requiredCredits: 16, rule: { kind: 'tagSet', tags: ['数学'] } },
          { id: 'g-foundation-physics', name: '自然科学基础', requiredCredits: 10, rule: { kind: 'tagSet', tags: ['物理'] } },
          {
            id: 'g-foundation-cs',
            name: '计算基础',
            requiredCredits: 6,
            rule: { kind: 'courseSet', courseCodes: ['CS101', 'CS102'] },
          },
        ],
      },
      {
        id: 'g-admission',
        name: '专业准入课程',
        requiredCredits: 20,
        children: [
          {
            id: 'g-admission-required',
            name: '准入必修',
            requiredCredits: 12,
            rule: { kind: 'courseSet', courseCodes: ['CS201', 'CS202', 'CS203'] },
          },
          { id: 'g-admission-elective', name: '准入选修', requiredCredits: 8, rule: { kind: 'tagSet', tags: ['专业准入'] } },
        ],
      },
      {
        id: 'g-core',
        name: '专业核心课程',
        requiredCredits: 24,
        children: [
          {
            id: 'g-core-required',
            name: '核心必修',
            requiredCredits: 16,
            rule: { kind: 'courseSet', courseCodes: ['CS301', 'CS302', 'CS303', 'CS304', 'CS305'] },
            note: '五门中任选四门，共 16 学分',
          },
          { id: 'g-core-elective', name: '核心选修', requiredCredits: 8, rule: { kind: 'tagSet', tags: ['专业核心选修'] } },
        ],
      },
      {
        id: 'g-major-elective',
        name: '专业选修课程',
        requiredCredits: 16,
        children: [
          { id: 'g-major-elective-all', name: '专业选修', requiredCredits: 16, rule: { kind: 'tagSet', tags: ['专业选修'] } },
        ],
      },
      {
        id: 'g-practice',
        name: '实践环节',
        requiredCredits: 22,
        children: [
          { id: 'g-practice-lab', name: '实验与实践', requiredCredits: 10, rule: { kind: 'tagSet', tags: ['实验'] } },
          { id: 'g-practice-intern', name: '生产实习', requiredCredits: 4, rule: { kind: 'tagSet', tags: ['实习'] } },
          { id: 'g-practice-thesis', name: '毕业论文', requiredCredits: 8, rule: { kind: 'tagSet', tags: ['毕业设计'] } },
        ],
      },
    ],
  };
}

function buildSections(courses: CourseSeed[]): Section[] {
  const sections: Section[] = [];
  for (const seed of courses) {
    const push = (termId: string, seedSections: SectionSeed[], inCurrent: boolean) => {
      for (const section of seedSections) {
        sections.push({
          id: `sec-${termId}-${seed.code}-${section.classNo}`,
          courseId: seed.code,
          courseCode: seed.code,
          termId,
          classNo: section.classNo,
          teachers: section.teachers,
          meetings: section.meetings.map(([day, startPeriod, endPeriod, parity, location]) => ({
            day,
            startPeriod,
            endPeriod,
            weeks: { from: 1, to: 16, parity: parity ?? 'all' },
            location,
            campus: section.campus,
          })),
          campus: section.campus,
          note: section.note,
          capacity: 60,
          enrolled: 40 + (seed.code.charCodeAt(seed.code.length - 1) % 18),
          inCurrentTimetable: inCurrent,
          source: { kind: 'catalog', mode: 'mock', fetchedAt: new Date().toISOString() },
        });
      }
    };
    if (seed.offer) push(PLANNING_TERM, seed.offer, false);
    if (seed.current) push(CURRENT_TERM, seed.current, true);
  }
  return sections;
}

function buildTranscript(courses: CourseSeed[]): TranscriptRecord[] {
  const records: TranscriptRecord[] = [];
  for (const seed of courses) {
    if (!seed.taken) continue;
    const status = seed.taken.status ?? 'passed';
    records.push({
      courseCode: seed.code,
      courseName: seed.name,
      credits: seed.credits,
      score: seed.taken.score,
      gpa: seed.taken.score ? Math.max(0, (seed.taken.score - 50) / 10) : undefined,
      termId: seed.taken.termId,
      category: seed.category,
      tags: seed.tags,
      status,
      creditsEarned: status === 'passed' ? seed.credits : 0,
      source: { kind: 'transcript', mode: 'mock', fetchedAt: new Date().toISOString(), url: 'https://ehall.nju.edu.cn/' },
    });
  }
  return records;
}

function buildWarnings(): AcademicWarning[] {
  return [
    {
      id: 'warn-core-progress',
      level: 'info',
      title: '专业核心课程还剩 12 学分',
      detail:
        '操作系统、计算机网络、数据库系统正在修读（8 学分），还需从编译原理、计算机体系结构中至少修读一门（4 学分）。',
      rule: '核心必修模块未覆盖',
      termId: PLANNING_TERM,
      source: { kind: 'warning', mode: 'mock', fetchedAt: new Date().toISOString() },
    },
    {
      id: 'warn-practice',
      level: 'warning',
      title: '实践环节尚未开始',
      detail: '生产实习（4 学分）与毕业论文（8 学分）还未安排，通常在大三暑期与大四完成。',
      rule: '实践环节学分为 0',
      source: { kind: 'warning', mode: 'mock', fetchedAt: new Date().toISOString() },
    },
    {
      id: 'warn-credit-load',
      level: 'info',
      title: '本学期已选 12 学分',
      detail: '当前学期在修 12 学分，低于培养方案建议的每学期 18-20 学分。',
      rule: '学期学分低于建议值',
      termId: CURRENT_TERM,
      source: { kind: 'warning', mode: 'mock', fetchedAt: new Date().toISOString() },
    },
  ];
}

function buildPlans(sections: Section[]): Plan[] {
  const at = '2026-11-08T10:00:00.000Z';
  const find = (code: string, classNo: string) =>
    sections.find((s) => s.courseCode === code && s.termId === PLANNING_TERM && s.classNo === classNo)?.id;

  const makeItem = (index: number, sectionId: string, courseCode: string, status: 'selected' | 'backup' = 'selected') => ({
    id: `item-${index}-${courseCode}`,
    sectionId,
    courseCode,
    status,
    addedAt: at,
    origin: 'pool' as const,
  });

  const planAItems = [
    makeItem(1, find('CS304', '01') ?? '', 'CS304'),
    makeItem(2, find('CS322', '01') ?? '', 'CS322'),
    makeItem(3, find('CS212', '01') ?? '', 'CS212'),
    makeItem(4, find('CS334', '01') ?? '', 'CS334'),
    makeItem(5, find('GEN2001', '01') ?? '', 'GEN2001'),
    makeItem(6, find('CS332', '01') ?? '', 'CS332', 'backup'),
  ].filter((item) => item.sectionId);

  const planBItems = [
    makeItem(11, find('CS304', '02') ?? '', 'CS304'),
    makeItem(12, find('CS321', '01') ?? '', 'CS321'),
    makeItem(13, find('CS333', '01') ?? '', 'CS333'),
    makeItem(14, find('GEN2003', '01') ?? '', 'GEN2003'),
    makeItem(15, find('CS323', '01') ?? '', 'CS323', 'backup'),
  ].filter((item) => item.sectionId);

  return [
    {
      id: 'plan-a',
      name: '方案 A · 核心优先',
      termId: PLANNING_TERM,
      color: '#7c3aed',
      items: planAItems,
      note: '先把核心必修补齐，通识选一门轻松点的。',
      createdAt: at,
      updatedAt: at,
    },
    {
      id: 'plan-b',
      name: '方案 B · 时间集中',
      termId: PLANNING_TERM,
      color: '#0f766e',
      items: planBItems,
      note: '把课压到周二到周四，周一周五留白。',
      createdAt: at,
      updatedAt: at,
    },
  ];
}

function buildSources(): SourceRecord[] {
  const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
  return [
    {
      kind: 'program',
      label: '本科人才培养方案',
      mode: 'mock',
      status: 'ok',
      fetchedAt: minutesAgo(9),
      detail: '2024版 · 计算机科学与技术',
      url: 'https://ehallapp.nju.edu.cn/jwapp/sys/qxfacx/*default/index.do#/pyfacx',
      records: 1,
    },
    {
      kind: 'transcript',
      label: '成绩与已修记录',
      mode: 'mock',
      status: 'ok',
      fetchedAt: minutesAgo(9),
      detail: '2024-2025-1 至 2026-2027-1',
      records: 46,
    },
    {
      kind: 'timetable',
      label: '本学期课表',
      mode: 'mock',
      status: 'ok',
      fetchedAt: minutesAgo(12),
      detail: '2026-2027-1 · 5 门在修课程',
      url: 'https://ehallapp.nju.edu.cn/jwapp/sys/kcbcx/*default/index.do#/qxkcb',
      records: 5,
    },
    {
      kind: 'catalog',
      label: '开课与教学班',
      mode: 'mock',
      status: 'ok',
      fetchedAt: minutesAgo(12),
      detail: '2026-2027-2 · 22 门开课',
      records: 22,
    },
    {
      kind: 'warning',
      label: '学业预警',
      mode: 'mock',
      status: 'ok',
      fetchedAt: minutesAgo(31),
      detail: '3 条提示',
      url: 'https://ehallapp.nju.edu.cn/jwapp/sys/xyyj/*default/index.do#/xsxyyjjg',
      records: 3,
    },
  ];
}

export function buildSeedDb(): Db {
  const courses: Course[] = COURSES.map((seed) => ({
    id: seed.code,
    code: seed.code,
    name: seed.name,
    credits: seed.credits,
    department: seed.department,
    category: seed.category,
    assessment: seed.assessment,
    description: seed.description,
    tags: seed.tags,
    source: { kind: 'catalog', mode: 'mock', fetchedAt: new Date().toISOString() },
  }));

  const sections = buildSections(COURSES);
  const transcript = buildTranscript(COURSES);
  const plans = buildPlans(sections);

  return {
    version: 1,
    profile: {
      studentId: '2024DEMO01',
      name: '周同学',
      college: '计算机科学与技术系',
      major: '计算机科学与技术',
      gradeYear: 2024,
      programId: 'prog-cs-2024',
      demo: true,
    },
    terms: TERMS,
    periods: DEFAULT_PERIODS,
    courses,
    sections,
    program: buildProgram(),
    transcript,
    warnings: buildWarnings(),
    plans,
    sources: buildSources(),
    settings: {
      currentTermId: CURRENT_TERM,
      planningTermId: PLANNING_TERM,
      creditCap: 30,
      allocationPolicy:
        '课程按「指定课程 > 标签匹配 > 任意选修」的优先级计入培养方案，一门课只计入一个模块；溢出学分仍显示，但会标为溢出。',
    },
    rawSnapshots: [],
  };
}

export { TERMS, COURSES, PLANNING_TERM, CURRENT_TERM };
