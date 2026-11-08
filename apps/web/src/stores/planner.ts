/**
 * 规划状态。
 *
 * 交互上的核心决定：**所有分析在本地即时算**。
 * 拖进一门课，学分/缺口/冲突在下一帧就更新；网络请求只负责持久化。
 * 这样才有"低风险试选"的手感——这也是本项目的核心体验假设。
 */

import { defineStore } from 'pinia';
import type { Plan, PlanAnalysis, PlanItem } from '@planner/shared';
import { api } from '@/api/client';
import { useDataStore } from './data';
import { analyzePlanLocal } from '@/utils/analyze';

interface Snapshot {
  planId: string;
  items: PlanItem[];
  label: string;
}

type SaveState = 'saved' | 'saving' | 'error';

export const usePlannerStore = defineStore('planner', {
  state: () => ({
    activePlanId: '',
    /** 0 = 全部周；1..n = 指定教学周 */
    week: 0,
    history: [] as Snapshot[],
    future: [] as Snapshot[],
    saveState: 'saved' as SaveState,
    lastSavedAt: '',
    saveTimer: null as ReturnType<typeof setTimeout> | null,
  }),

  getters: {
    activePlan(state): Plan | undefined {
      const data = useDataStore();
      return data.plans.find((plan) => plan.id === state.activePlanId) ?? data.plans[0];
    },

    canUndo: (state) => state.history.length > 0,
    canRedo: (state) => state.future.length > 0,

    analysis(): PlanAnalysis | null {
      const data = useDataStore();
      const plan = this.activePlan;
      if (!plan || !data.program) return null;
      return analyzePlanLocal(plan, {
        program: data.program,
        transcript: data.transcript,
        courses: data.courses,
        sections: data.allSections,
        weekCount: data.planningTerm?.weekCount ?? 20,
        creditCap: 30,
      });
    },

    selectedItems(): PlanItem[] {
      return this.activePlan?.items.filter((item) => item.status === 'selected') ?? [];
    },

    backupItems(): PlanItem[] {
      return this.activePlan?.items.filter((item) => item.status === 'backup') ?? [];
    },

    hasSection(state) {
      return (sectionId: string) => this.activePlan?.items.some((item) => item.sectionId === sectionId) ?? false;
    },
  },

  actions: {
    hydrate(plans: Plan[]) {
      if (!this.activePlanId && plans.length > 0) this.activePlanId = plans[0]!.id;
    },

    setActive(planId: string) {
      this.activePlanId = planId;
      this.history = [];
      this.future = [];
    },

    setWeek(week: number) {
      this.week = week;
    },

    snapshot(label: string) {
      const plan = this.activePlan;
      if (!plan) return;
      this.history.push({ planId: plan.id, items: plan.items.map((item) => ({ ...item })), label });
      if (this.history.length > 40) this.history.shift();
      this.future = [];
    },

    /** 添加教学班；同一教学班重复添加会被忽略。 */
    addSection(sectionId: string, status: 'selected' | 'backup' = 'selected'): boolean {
      const data = useDataStore();
      const plan = this.activePlan;
      if (!plan) return false;
      if (plan.items.some((item) => item.sectionId === sectionId)) return false;

      const section = data.sectionById.get(sectionId);
      if (!section) return false;

      this.snapshot(`加入《${data.courseByCode.get(section.courseCode)?.name ?? section.courseCode}》`);
      plan.items.push({
        id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        sectionId,
        courseCode: section.courseCode,
        status,
        addedAt: new Date().toISOString(),
        origin: 'pool',
      });
      plan.updatedAt = new Date().toISOString();
      void this.persist();
      return true;
    },

    /** 加课程（自动挑选一个不冲突的教学班）。 */
    addCourse(courseCode: string): { ok: boolean; sectionId?: string; conflict?: boolean } {
      const data = useDataStore();
      const plan = this.activePlan;
      if (!plan) return { ok: false };
      const sections = data.sections.filter((section) => section.courseCode === courseCode);
      if (sections.length === 0) return { ok: false };

      const analysis = this.analysis;
      const conflicted = new Set(
        analysis?.conflicts
          .filter((issue) => issue.kind === 'time' && issue.severity === 'error')
          .flatMap((issue) => issue.itemIds) ?? [],
      );
      void conflicted;

      const planBlocks = plan.items
        .filter((item) => item.status === 'selected')
        .map((item) => data.sectionById.get(item.sectionId))
        .filter((section): section is NonNullable<typeof section> => Boolean(section));

      const free = sections.find((section) =>
        section.meetings.every((meeting) =>
          planBlocks.every((existing) =>
            existing.meetings.every((other) => {
              if (meeting.day !== other.day) return true;
              if (Math.max(meeting.startPeriod, other.startPeriod) > Math.min(meeting.endPeriod, other.endPeriod)) return true;
              return false;
            }),
          ),
        ),
      );

      const target = free ?? sections[0]!;
      const added = this.addSection(target.id, 'selected');
      return { ok: added, sectionId: target.id, conflict: !free };
    },

    removeItem(itemId: string) {
      const plan = this.activePlan;
      if (!plan) return;
      const item = plan.items.find((entry) => entry.id === itemId);
      if (!item) return;
      this.snapshot('移除课程');
      plan.items = plan.items.filter((entry) => entry.id !== itemId);
      plan.updatedAt = new Date().toISOString();
      void this.persist();
    },

    toggleStatus(itemId: string) {
      const plan = this.activePlan;
      if (!plan) return;
      const item = plan.items.find((entry) => entry.id === itemId);
      if (!item) return;
      this.snapshot(item.status === 'backup' ? '转为正式课程' : '移入备选');
      item.status = item.status === 'backup' ? 'selected' : 'backup';
      plan.updatedAt = new Date().toISOString();
      void this.persist();
    },

    undo() {
      const snapshot = this.history.pop();
      if (!snapshot) return;
      const data = useDataStore();
      const plan = data.plans.find((item) => item.id === snapshot.planId);
      if (!plan) return;
      this.future.push({ planId: plan.id, items: plan.items.map((item) => ({ ...item })), label: snapshot.label });
      plan.items = snapshot.items;
      plan.updatedAt = new Date().toISOString();
      void this.persist(true);
    },

    redo() {
      const snapshot = this.future.pop();
      if (!snapshot) return;
      const data = useDataStore();
      const plan = data.plans.find((item) => item.id === snapshot.planId);
      if (!plan) return;
      this.history.push({ planId: plan.id, items: plan.items.map((item) => ({ ...item })), label: snapshot.label });
      plan.items = snapshot.items;
      plan.updatedAt = new Date().toISOString();
      void this.persist(true);
    },

    /** 防抖持久化：拖拽过程中不会每个动作都发请求。 */
    persist(immediate = false) {
      if (this.saveTimer) {
        clearTimeout(this.saveTimer);
        this.saveTimer = null;
      }
      const run = async () => {
        const plan = this.activePlan;
        if (!plan) return;
        const data = useDataStore();
        this.saveState = 'saving';
        try {
          const result = await api.saveItems(
            plan.id,
            plan.items.map((item) => ({ sectionId: item.sectionId, status: item.status, note: item.note })),
          );
          data.upsertPlan({ ...result.plan });
          this.saveState = 'saved';
          this.lastSavedAt = new Date().toISOString();
        } catch {
          this.saveState = 'error';
        }
      };

      if (immediate) {
        void run();
        return;
      }
      this.saveTimer = setTimeout(() => void run(), 420);
    },
  },
});
