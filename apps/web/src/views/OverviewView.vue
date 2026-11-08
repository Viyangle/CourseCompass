<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import {
  formatCredits,
  formatRelativeTime,
  type Plan,
  type PlanItem,
  type RequirementProgress,
} from '@planner/shared';
import { useDataStore } from '@/stores/data';
import { usePlannerStore } from '@/stores/planner';
import { analyzePlanLocal, progressLocal, type AnalysisDeps } from '@/utils/analyze';
import StatCard from '@/components/StatCard.vue';
import RequirementBar from '@/components/RequirementBar.vue';
import WeekGrid from '@/components/WeekGrid.vue';
import AppIcon from '@/components/AppIcon.vue';

const data = useDataStore();
const planner = usePlannerStore();
const router = useRouter();

const deps = computed<AnalysisDeps>(() => ({
  program: data.program,
  transcript: data.transcript,
  courses: data.courses,
  sections: data.allSections,
  weekCount: data.planningTerm?.weekCount ?? 20,
  creditCap: 30,
}));

const progress = computed(() => progressLocal(planner.activePlan, deps.value));
const analysis = computed(() => (planner.activePlan ? analyzePlanLocal(planner.activePlan, deps.value) : null));

const greeting = computed(() => {
  const hour = new Date().getHours();
  if (hour < 6) return '凌晨好';
  if (hour < 11) return '早上好';
  if (hour < 14) return '中午好';
  if (hour < 18) return '下午好';
  return '晚上好';
});

const totalPercent = computed(() => {
  if (!progress.value || progress.value.totalRequired === 0) return 0;
  return Math.round(((progress.value.totalEarned + progress.value.totalPlanned) / progress.value.totalRequired) * 100);
});

const inProgressCredits = computed(() =>
  data.transcript.filter((record) => record.status === 'in-progress').reduce((sum, record) => sum + record.credits, 0),
);

const leaves = computed<RequirementProgress[]>(() => {
  const out: RequirementProgress[] = [];
  const walk = (nodes: RequirementProgress[]) => {
    for (const node of nodes) {
      if (node.children && node.children.length > 0) walk(node.children);
      else out.push(node);
    }
  };
  if (progress.value) walk(progress.value.modules);
  return out;
});

const unmet = computed(() =>
  leaves.value
    .filter((node) => node.status !== 'met')
    .sort(
      (a, b) =>
        Math.max(0, b.requiredCredits - b.earnedCredits - b.plannedCredits) -
        Math.max(0, a.requiredCredits - a.earnedCredits - a.plannedCredits),
    )
    .slice(0, 5),
);

const currentItems = computed<PlanItem[]>(() =>
  data.currentTermSections.map((section) => ({
    id: section.id,
    sectionId: section.id,
    courseCode: section.courseCode,
    status: 'selected' as const,
    addedAt: '',
  })),
);

const planCards = computed(() =>
  data.plans.map((plan) => ({ plan, analysis: analyzePlanLocal(plan, deps.value) })),
);

function openPlan(plan: Plan) {
  planner.setActive(plan.id);
  router.push('/planner');
}

const issueCount = computed(() => {
  const warningCount = data.warnings.filter((warning) => warning.level !== 'info').length;
  return (analysis.value?.conflicts.length ?? 0) + warningCount;
});
</script>

<template>
  <div class="overview">
    <header class="head">
      <div>
        <h1>{{ greeting }}，{{ data.profile?.name ?? '同学' }}</h1>
        <p class="sub">
          {{ data.planningTerm?.name }} · 规划中
          <span class="dot">·</span>
          {{ data.profile?.major }} · {{ data.profile?.gradeYear }} 级
        </p>
      </div>
      <div class="head-actions">
        <router-link to="/program" class="btn"><AppIcon name="program" :size="14" /> 培养方案</router-link>
        <router-link to="/planner" class="btn btn-primary"><AppIcon name="calendar" :size="14" /> 继续规划</router-link>
      </div>
    </header>

    <section class="stats">
      <StatCard
        label="毕业学分"
        :value="`${formatCredits(progress?.totalEarned ?? 0)} / ${formatCredits(progress?.totalRequired ?? 0)}`"
        :hint="`含计划后 ${totalPercent}%`"
        :progress="totalPercent"
        tone="accent"
      />
      <StatCard
        label="本学期在修"
        :value="`${formatCredits(inProgressCredits)} 学分`"
        :hint="`${data.transcript.filter((r) => r.status === 'in-progress').length} 门课程`"
      />
      <StatCard
        label="当前方案"
        :value="`${formatCredits(analysis?.metrics.totalCredits ?? 0)} 学分`"
        :hint="planner.activePlan ? planner.activePlan.name : '还没有方案'"
        :progress="Math.min(100, ((analysis?.metrics.totalCredits ?? 0) / 25) * 100)"
        tone="ok"
      />
      <StatCard
        label="待处理"
        :value="`${issueCount}`"
        :hint="`${analysis?.metrics.conflictCount ?? 0} 个时间冲突 · ${data.warnings.length} 条学业提醒`"
        :tone="issueCount > 0 ? 'warn' : 'default'"
      />
    </section>

    <div class="grid">
      <section class="card block">
        <div class="block-head">
          <div>
            <h2>还差什么</h2>
            <p class="hint">按缺口从大到小排列；带斜纹的部分是当前方案已覆盖、但还没修完的学分。</p>
          </div>
          <router-link to="/program" class="link">全部要求 <AppIcon name="arrow" :size="13" /></router-link>
        </div>
        <div class="req-list">
          <div v-for="node in unmet" :key="node.nodeId" class="req-row">
            <RequirementBar :node="node" />
          </div>
          <p v-if="unmet.length === 0" class="empty">所有模块都已满足，剩下的是选修与毕业论文。</p>
        </div>
      </section>

      <section class="card block">
        <div class="block-head">
          <div>
            <h2>本周课表</h2>
            <p class="hint">{{ data.currentTerm?.name }} · 正在修读</p>
          </div>
          <span class="chip">{{ data.currentTermSections.length }} 门</span>
        </div>
        <WeekGrid
          :items="currentItems"
          :sections="data.currentTermSections"
          :courses="data.courses"
          :periods="data.periods"
          :week="0"
          compact
          :interactive="false"
        />
      </section>

      <section class="card block">
        <div class="block-head">
          <div>
            <h2>我的方案</h2>
            <p class="hint">点开任意一个继续编辑；方案之间可以并排比较。</p>
          </div>
          <router-link to="/compare" class="link">对比 <AppIcon name="arrow" :size="13" /></router-link>
        </div>
        <div class="plans">
          <button
            v-for="card in planCards"
            :key="card.plan.id"
            type="button"
            class="plan"
            :class="{ active: card.plan.id === planner.activePlan?.id }"
            @click="openPlan(card.plan)"
          >
            <span class="plan-color" :style="{ background: card.plan.color ?? 'var(--accent)' }" />
            <span class="plan-body">
              <strong>{{ card.plan.name }}</strong>
              <span class="plan-meta">
                {{ formatCredits(card.analysis?.metrics.totalCredits ?? 0) }} 学分 ·
                {{ card.analysis?.metrics.courseCount ?? 0 }} 门 ·
                <template v-if="(card.analysis?.metrics.conflictCount ?? 0) > 0">
                  <b class="bad">{{ card.analysis?.metrics.conflictCount }} 处冲突</b>
                </template>
                <template v-else>无冲突</template>
              </span>
            </span>
            <span class="plan-load">
              {{ card.analysis?.metrics.activeDays.length ?? 0 }} 天到校
            </span>
          </button>
        </div>
      </section>

      <section class="card block">
        <div class="block-head">
          <div>
            <h2>数据来源</h2>
            <p class="hint">每条数据都标注了来源与时间，便于核对。</p>
          </div>
          <router-link to="/settings" class="link">管理 <AppIcon name="arrow" :size="13" /></router-link>
        </div>
        <ul class="sources">
          <li v-for="source in data.sources" :key="source.kind">
            <span class="source-icon" :class="source.status">
              <AppIcon :name="source.status === 'ok' ? 'check' : 'alert'" :size="12" />
            </span>
            <div class="source-text">
              <strong>{{ source.label }}</strong>
              <span>{{ source.detail ?? '' }}</span>
            </div>
            <span class="source-time">{{ formatRelativeTime(source.fetchedAt) }}</span>
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>

<style scoped>
.overview {
  max-width: 1320px;
  margin: 0 auto;
}
.head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 20px;
}
.sub {
  margin-top: 4px;
  color: var(--muted);
  font-size: 12.5px;
}
.dot {
  margin: 0 6px;
  opacity: 0.5;
}
.head-actions {
  display: flex;
  gap: 8px;
  flex: none;
}

.stats {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 16px;
}

.grid {
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr);
  gap: 16px;
}
.block {
  padding: 16px 18px 18px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}
.block-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}
.block-head h2 {
  font-size: 14.5px;
}
.hint {
  margin-top: 3px;
  font-size: 11.5px;
  color: var(--muted);
  line-height: 1.5;
}
.link {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 11.5px;
  color: var(--accent-ink);
  flex: none;
}
.link:hover {
  text-decoration: underline;
}

.req-list {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.plans {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.plan {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--surface);
  cursor: pointer;
  text-align: left;
  transition: all 0.15s ease;
}
.plan:hover {
  border-color: var(--line-strong);
  background: var(--surface-2);
}
.plan.active {
  border-color: var(--accent-line);
  background: var(--accent-soft);
}
.plan-color {
  width: 4px;
  height: 30px;
  border-radius: 4px;
  flex: none;
}
.plan-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}
.plan-body strong {
  font-size: 12.8px;
}
.plan-meta {
  font-size: 11px;
  color: var(--muted);
}
.bad {
  color: var(--danger);
  font-weight: 600;
}
.plan-load {
  font-size: 11px;
  color: var(--faint);
  flex: none;
}

.sources {
  display: flex;
  flex-direction: column;
  gap: 9px;
}
.sources li {
  display: flex;
  align-items: center;
  gap: 9px;
}
.source-icon {
  width: 20px;
  height: 20px;
  border-radius: 6px;
  display: grid;
  place-items: center;
  background: var(--ok-soft);
  color: var(--ok);
  flex: none;
}
.source-icon.stale,
.source-icon.pending {
  background: var(--warn-soft);
  color: var(--warn);
}
.source-icon.error {
  background: var(--danger-soft);
  color: var(--danger);
}
.source-text {
  display: flex;
  flex-direction: column;
  line-height: 1.35;
  flex: 1;
  min-width: 0;
}
.source-text strong {
  font-size: 12px;
  font-weight: 550;
}
.source-text span {
  font-size: 10.5px;
  color: var(--faint);
}
.source-time {
  font-size: 10.5px;
  color: var(--muted);
  flex: none;
}

.empty {
  font-size: 12px;
  color: var(--muted);
}

@media (max-width: 1180px) {
  .stats {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
