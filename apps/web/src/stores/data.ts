import { defineStore } from 'pinia';
import type {
  AcademicWarning,
  Course,
  PeriodConfig,
  Plan,
  ProgramVersion,
  Section,
  SourceRecord,
  StudentProfile,
  Term,
  TranscriptRecord,
} from '@planner/shared';
import { weekOfDate } from '@planner/shared';
import { api, type CatalogPayload } from '@/api/client';

export const useDataStore = defineStore('data', {
  state: () => ({
    loaded: false,
    loading: false,
    error: '',

    terms: [] as Term[],
    currentTermId: '',
    planningTermId: '',
    periods: [] as PeriodConfig[],
    profile: null as StudentProfile | null,
    program: null as ProgramVersion | null,
    transcript: [] as TranscriptRecord[],
    warnings: [] as AcademicWarning[],
    plans: [] as Plan[],
    sources: [] as SourceRecord[],

    courses: [] as Course[],
    sections: [] as Section[],
    currentTermSections: [] as Section[],
    catalogTermId: '',
  }),

  getters: {
    currentTerm: (state) => state.terms.find((term) => term.id === state.currentTermId),
    planningTerm: (state) => state.terms.find((term) => term.id === state.planningTermId),
    courseByCode: (state) => new Map(state.courses.map((course) => [course.code, course])),
    sectionById: (state) => new Map([...state.sections, ...state.currentTermSections].map((section) => [section.id, section])),
    /** 规划学期第 1 周在日历上对应的教学周（用于默认显示"本周"） */
    planningWeek: (state) => {
      const term = state.terms.find((t) => t.id === state.planningTermId);
      if (!term) return 1;
      return Math.min(term.weekCount, Math.max(1, weekOfDate(term.startDate)));
    },
    allSections: (state) => {
      // 当前学期与规划学期可能是同一个学期，按 id 去重，避免课表里出现重复块。
      const map = new Map(state.sections.map((section) => [section.id, section]));
      for (const section of state.currentTermSections) map.set(section.id, section);
      return [...map.values()];
    },
  },

  actions: {
    async load() {
      if (this.loading) return;
      this.loading = true;
      this.error = '';
      try {
        const bootstrap = await api.bootstrap();
        this.terms = bootstrap.terms;
        this.currentTermId = bootstrap.currentTermId;
        this.planningTermId = bootstrap.planningTermId;
        this.periods = bootstrap.periods;
        this.profile = bootstrap.profile;
        this.program = bootstrap.program;
        this.transcript = bootstrap.transcript;
        this.warnings = bootstrap.warnings;
        this.plans = bootstrap.plans;
        this.sources = bootstrap.sources;
        await this.loadCatalog();
        this.loaded = true;
      } catch (error) {
        this.error = error instanceof Error ? error.message : '数据加载失败';
      } finally {
        this.loading = false;
      }
    },

    async loadCatalog(termId?: string) {
      const payload: CatalogPayload = await api.catalog(termId ?? this.planningTermId);
      this.courses = payload.courses;
      this.sections = payload.sections;
      this.currentTermSections = payload.currentTermSections;
      this.catalogTermId = payload.termId;
    },

    async sync(sources?: string[]) {
      await api.sync(sources);
      await this.load();
    },

    setPlans(plans: Plan[]) {
      this.plans = plans;
    },

    upsertPlan(plan: Plan) {
      const index = this.plans.findIndex((item) => item.id === plan.id);
      if (index >= 0) this.plans[index] = plan;
      else this.plans.push(plan);
    },

    removePlan(id: string) {
      this.plans = this.plans.filter((plan) => plan.id !== id);
    },
  },
});
