<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { formatCredits, type PlanComparison } from '@planner/shared';
import { api } from '@/api/client';
import { useDataStore } from '@/stores/data';
import { usePlannerStore } from '@/stores/planner';
import AppIcon from '@/components/AppIcon.vue';
import { toast } from '@/composables/toast';

const data = useDataStore();
const planner = usePlannerStore();
const router = useRouter();

const selected = ref<string[]>(data.plans.slice(0, 2).map((plan) => plan.id));
const comparison = ref<PlanComparison | null>(null);
const loading = ref(false);

const canCompare = computed(() => selected.value.length >= 2);

async function load() {
  if (!canCompare.value) {
    comparison.value = null;
    return;
  }
  loading.value = true;
  try {
    comparison.value = await api.compare(selected.value);
  } catch (error) {
    toast(error instanceof Error ? error.message : '对比失败', 'error');
  } finally {
    loading.value = false;
  }
}

function toggle(id: string) {
  const index = selected.value.indexOf(id);
  if (index >= 0) {
    if (selected.value.length <= 2) return;
    selected.value.splice(index, 1);
  } else {
    if (selected.value.length >= 4) {
      toast('最多同时对比 4 个方案', 'info');
      return;
    }
    selected.value.push(id);
  }
}

watch(selected, load, { deep: true });
onMounted(load);

const planCount = computed(() => comparison.value?.plans.length ?? 1);
const metricGridStyle = computed(() => ({
  gridTemplateColumns: `120px repeat(${planCount.value}, minmax(0, 1fr))`,
}));
const coverageGridStyle = computed(() => ({
  gridTemplateColumns: `150px repeat(${planCount.value}, minmax(0, 1fr))`,
}));
const courseGridStyle = computed(() => ({
  gridTemplateColumns: `minmax(180px, 1.6fr) 60px repeat(${planCount.value}, minmax(0, 1fr))`,
}));

const metricRows = computed(() => {  if (!comparison.value) return [];
  const plans = comparison.value.plans;
  return [
    { label: '总学分', get: (index: number) => `${formatCredits(plans[index]!.metrics.totalCredits)}`, best: 'max' as const },
    { label: '课程门数', get: (index: number) => `${plans[index]!.metrics.courseCount}` },
    { label: '到校天数', get: (index: number) => `${plans[index]!.metrics.activeDays.length} 天`, best: 'min' as const },
    { label: '每周平均课时', get: (index: number) => `${formatCredits(plans[index]!.metrics.weeklyPeriods)} 节` },
    { label: '空档节次', get: (index: number) => `${plans[index]!.metrics.gapPeriods}`, best: 'min' as const },
    { label: '时间冲突', get: (index: number) => `${plans[index]!.metrics.conflictCount}`, best: 'min' as const },
    { label: '提醒数', get: (index: number) => `${plans[index]!.metrics.warningCount}`, best: 'min' as const },
  ];
});

function moduleCoverage(planIndex: number, moduleId: string): { earned: number; planned: number; required: number } | null {
  const module = comparison.value?.plans[planIndex]?.coverage.find((node) => node.nodeId === moduleId);
  if (!module) return null;
  return { earned: module.earnedCredits, planned: module.plannedCredits, required: module.requiredCredits };
}

const modules = computed(() => comparison.value?.plans[0]?.coverage ?? []);

function bestValue(rowIndex: number): number | null {
  const plans = comparison.value?.plans ?? [];
  const row = metricRows.value[rowIndex];
  if (!row?.best || plans.length === 0) return null;
  const values = plans.map((plan) => {
    switch (row.label) {
      case '总学分':
        return plan.metrics.totalCredits;
      case '到校天数':
        return plan.metrics.activeDays.length;
      case '空档节次':
        return plan.metrics.gapPeriods;
      case '时间冲突':
        return plan.metrics.conflictCount;
      case '提醒数':
        return plan.metrics.warningCount;
      default:
        return 0;
    }
  });
  return row.best === 'max' ? Math.max(...values) : Math.min(...values);
}

function isBest(rowIndex: number, planIndex: number): boolean {
  const best = bestValue(rowIndex);
  if (best === null) return false;
  const plans = comparison.value?.plans ?? [];
  switch (metricRows.value[rowIndex]?.label) {
    case '总学分':
      return plans[planIndex]!.metrics.totalCredits === best;
    case '到校天数':
      return plans[planIndex]!.metrics.activeDays.length === best;
    case '空档节次':
      return plans[planIndex]!.metrics.gapPeriods === best;
    case '时间冲突':
      return plans[planIndex]!.metrics.conflictCount === best;
    case '提醒数':
      return plans[planIndex]!.metrics.warningCount === best;
    default:
      return false;
  }
}

function editPlan(id: string) {
  planner.setActive(id);
  router.push('/planner');
}
</script>

<template>
  <div class="compare">
    <header class="head">
      <div>
        <h1>方案对比</h1>
        <p class="sub">同一张表里看学分、时间与风险的差别。选择 2–4 个方案。</p>
      </div>
    </header>

    <section class="picker card">
      <button
        v-for="plan in data.plans"
        :key="plan.id"
        type="button"
        class="pick"
        :class="{ on: selected.includes(plan.id) }"
        @click="toggle(plan.id)"
      >
        <span class="dot" :style="{ background: plan.color ?? 'var(--accent)' }" />
        <span class="pick-body">
          <strong>{{ plan.name }}</strong>
          <span>{{ plan.items.filter((item) => item.status === 'selected').length }} 门 · {{ plan.items.filter((item) => item.status === 'backup').length }} 门备选</span>
        </span>
        <span class="check" :class="{ on: selected.includes(plan.id) }">
          <AppIcon v-if="selected.includes(plan.id)" name="check" :size="12" />
        </span>
      </button>
      <p v-if="data.plans.length < 2" class="hint">至少需要两个方案。到「选课规划」里复制或新建一个。</p>
    </section>

    <div v-if="loading" class="loading">正在计算…</div>

    <template v-else-if="comparison">
      <section class="matrix card">
        <div class="mrow mhead" :style="metricGridStyle">
          <span class="label">指标</span>
          <span v-for="plan in comparison.plans" :key="plan.id" class="plan-col">
            <span class="dot" :style="{ background: plan.color ?? 'var(--accent)' }" />
            {{ plan.name }}
            <button type="button" class="edit" @click="editPlan(plan.id)">编辑</button>
          </span>
        </div>
        <div v-for="(row, rowIndex) in metricRows" :key="row.label" class="mrow" :style="metricGridStyle">
          <span class="label">{{ row.label }}</span>
          <span v-for="(plan, planIndex) in comparison.plans" :key="plan.id" class="cell num" :class="{ best: isBest(rowIndex, planIndex) }">
            {{ row.get(planIndex) }}
            <AppIcon v-if="isBest(rowIndex, planIndex) && row.best" name="check" :size="11" />
          </span>
        </div>
      </section>

      <section class="card coverage">
        <div class="section-head">
          <h2>培养要求覆盖</h2>
          <span class="faint">已获 + 计划 / 要求</span>
        </div>
        <div class="cov-table">
          <div class="crow chead" :style="coverageGridStyle">
            <span class="clabel">模块</span>
            <span v-for="plan in comparison.plans" :key="plan.id" class="cval">{{ plan.name }}</span>
          </div>
          <div v-for="module in modules" :key="module.nodeId" class="crow" :style="coverageGridStyle">
            <span class="clabel">{{ module.name }}</span>
            <span v-for="(plan, planIndex) in comparison.plans" :key="plan.id" class="cval">
              <template v-if="moduleCoverage(planIndex, module.nodeId)">
                <b class="num">{{ formatCredits(moduleCoverage(planIndex, module.nodeId)!.earned + moduleCoverage(planIndex, module.nodeId)!.planned) }}</b>
                <span class="faint num">/{{ formatCredits(moduleCoverage(planIndex, module.nodeId)!.required) }}</span>
              </template>
              <span v-else class="faint">—</span>
            </span>
          </div>
        </div>
      </section>

      <section class="card courses">
        <div class="section-head">
          <h2>逐门课程</h2>
          <span class="faint">✓ 已选 · ◐ 备选 · — 未选</span>
        </div>
        <div class="ctable">
          <div class="trow thead" :style="courseGridStyle">
            <span class="cname">课程</span>
            <span class="ccredits">学分</span>
            <span v-for="plan in comparison.plans" :key="plan.id" class="cplan">{{ plan.name }}</span>
          </div>
          <div v-for="course in comparison.courses" :key="course.courseCode" class="trow" :style="courseGridStyle">
            <span class="cname">
              <span>{{ course.courseName }}</span>
              <span class="mono faint">{{ course.courseCode }}</span>
            </span>
            <span class="ccredits num">{{ course.credits }}</span>
            <span v-for="plan in comparison.plans" :key="plan.id" class="cplan">
              <span v-if="course.presence[plan.id] === 'selected'" class="mark on">已选</span>
              <span v-else-if="course.presence[plan.id] === 'backup'" class="mark backup">备选</span>
              <span v-else class="mark">—</span>
              <span v-if="course.conflictCount[plan.id] > 0" class="conflict-flag">{{ course.conflictCount[plan.id] }} 冲突</span>
            </span>
          </div>
          <p v-if="comparison.courses.length === 0" class="empty">两个方案都还没有课程。</p>
        </div>
      </section>
    </template>

    <div v-else class="empty-state card">
      <AppIcon name="compare" :size="26" />
      <p>选择至少两个方案开始对比。</p>
    </div>
  </div>
</template>

<style scoped>
.compare {
  max-width: 1280px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.head h1 {
  font-size: 22px;
}
.sub {
  margin-top: 4px;
  font-size: 12.5px;
  color: var(--muted);
}

.picker {
  display: flex;
  gap: 10px;
  padding: 12px;
  flex-wrap: wrap;
}
.pick {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 8px 10px 8px 12px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--surface);
  cursor: pointer;
  min-width: 200px;
  text-align: left;
  transition: all 0.15s ease;
}
.pick:hover {
  border-color: var(--line-strong);
}
.pick.on {
  border-color: var(--accent-line);
  background: var(--accent-soft);
}
.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex: none;
}
.pick-body {
  display: flex;
  flex-direction: column;
  gap: 1px;
  flex: 1;
}
.pick-body strong {
  font-size: 12.5px;
}
.pick-body span {
  font-size: 10.5px;
  color: var(--muted);
}
.check {
  width: 18px;
  height: 18px;
  border-radius: 5px;
  border: 1px solid var(--line-strong);
  display: grid;
  place-items: center;
  color: transparent;
}
.check.on {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}
.hint {
  font-size: 11.5px;
  color: var(--muted);
}

.loading {
  padding: 40px;
  text-align: center;
  color: var(--muted);
  font-size: 12.5px;
}

.matrix {
  overflow: hidden;
}
.mrow {
  display: grid;
  grid-template-columns: 120px repeat(4, minmax(0, 1fr));
  border-bottom: 1px solid var(--line);
}
.mrow:last-child {
  border-bottom: 0;
}
.mhead {
  background: var(--surface-2);
  align-items: stretch;
}
.label {
  padding: 10px 14px;
  font-size: 11px;
  color: var(--muted);
  border-right: 1px solid var(--line);
  display: flex;
  align-items: center;
}
.mhead .label {
  font-weight: 600;
}
.plan-col {
  padding: 10px 14px;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  font-weight: 600;
  border-right: 1px solid var(--line);
}
.plan-col:last-child {
  border-right: 0;
}
.edit {
  margin-left: auto;
  border: 0;
  background: none;
  font-size: 10.5px;
  color: var(--accent-ink);
  cursor: pointer;
}
.cell {
  padding: 10px 14px;
  font-size: 13px;
  border-right: 1px solid var(--line);
  display: flex;
  align-items: center;
  gap: 4px;
}
.cell:last-child {
  border-right: 0;
}
.cell.best {
  color: var(--ok);
  font-weight: 620;
  background: color-mix(in srgb, var(--ok-soft) 60%, white);
}

.section-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  padding: 14px 16px 10px;
}
.section-head h2 {
  font-size: 14.5px;
}
.faint {
  color: var(--faint);
  font-size: 11px;
}

.coverage,
.courses {
  overflow: hidden;
}
.cov-table,
.ctable {
  overflow-x: auto;
}
.crow {
  display: grid;
  grid-template-columns: 150px repeat(4, minmax(0, 1fr));
  border-top: 1px solid var(--line);
}
.chead {
  background: var(--surface-2);
  font-size: 11px;
  color: var(--muted);
  font-weight: 600;
}
.clabel {
  padding: 8px 16px;
  font-size: 11.5px;
  color: var(--ink-2);
  border-right: 1px solid var(--line);
}
.cval {
  padding: 8px 16px;
  font-size: 12px;
  border-right: 1px solid var(--line);
}
.cval:last-child {
  border-right: 0;
}

.ctable .trow {
  display: grid;
  grid-template-columns: minmax(180px, 1.6fr) 60px repeat(4, minmax(0, 1fr));
  border-top: 1px solid var(--line);
  align-items: center;
}
.ctable .thead {
  background: var(--surface-2);
  font-size: 11px;
  color: var(--muted);
  font-weight: 600;
  padding: 0;
}
.cname {
  padding: 8px 16px;
  display: flex;
  flex-direction: column;
  gap: 1px;
  font-size: 12.5px;
  border-right: 1px solid var(--line);
}
.ccredits {
  padding: 8px 12px;
  font-size: 12px;
  border-right: 1px solid var(--line);
}
.cplan {
  padding: 8px 16px;
  font-size: 12px;
  border-right: 1px solid var(--line);
  display: flex;
  align-items: center;
  gap: 6px;
}
.cplan:last-child {
  border-right: 0;
}
.mark {
  color: var(--faint);
  font-size: 11px;
}
.mark.on {
  color: var(--ok);
  font-weight: 600;
}
.mark.backup {
  color: var(--warn);
}
.conflict-flag {
  font-size: 9.5px;
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--danger-soft);
  color: var(--danger);
}
.empty {
  padding: 24px;
  text-align: center;
  color: var(--faint);
  font-size: 12px;
}

.empty-state {
  padding: 60px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  color: var(--faint);
  font-size: 12.5px;
}
</style>
