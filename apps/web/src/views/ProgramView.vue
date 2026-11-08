<script setup lang="ts">
import { computed, ref } from 'vue';
import {
  flattenRequirements,
  formatCredits,
  matchesRule,
  type RequirementNode,
  type RequirementProgress,
} from '@planner/shared';
import { useDataStore } from '@/stores/data';
import { usePlannerStore } from '@/stores/planner';
import { progressLocal, type AnalysisDeps } from '@/utils/analyze';
import RequirementBar from '@/components/RequirementBar.vue';
import AppIcon from '@/components/AppIcon.vue';
import { toast } from '@/composables/toast';
import { meetingText } from '@/utils/format';

const data = useDataStore();
const planner = usePlannerStore();

const deps = computed<AnalysisDeps>(() => ({
  program: data.program,
  transcript: data.transcript,
  courses: data.courses,
  sections: data.allSections,
  weekCount: data.planningTerm?.weekCount ?? 20,
}));

const progress = computed(() => progressLocal(planner.activePlan, deps.value));

const leaves = computed(() => (data.program ? flattenRequirements(data.program.modules) : []));

const selectedId = ref<string>('');
const selectedLeaf = computed(() => {
  if (leaves.value.length === 0) return null;
  const found = leaves.value.find((leaf) => leaf.node.id === selectedId.value);
  if (found) return found;
  const firstUnmet = leaves.value.find((leaf) => {
    const node = findProgressNode(leaf.node.id);
    return node && node.status !== 'met';
  });
  return firstUnmet ?? leaves.value[0]!;
});

const selectedNode = computed<RequirementNode | null>(() => selectedLeaf.value?.node ?? null);
const selectedProgress = computed<RequirementProgress | undefined>(() =>
  selectedNode.value ? findProgressNode(selectedNode.value.id) : undefined,
);

function findProgressNode(nodeId: string, nodes = progress.value?.modules): RequirementProgress | undefined {
  if (!nodes) return undefined;
  for (const node of nodes) {
    if (node.nodeId === nodeId) return node;
    if (node.children) {
      const found = findProgressNode(nodeId, node.children);
      if (found) return found;
    }
  }
  return undefined;
}

const totalPercent = computed(() => {
  if (!progress.value || progress.value.totalRequired === 0) return 0;
  return Math.round(((progress.value.totalEarned + progress.value.totalPlanned) / progress.value.totalRequired) * 100);
});

const passedCodes = computed(() => new Set(data.transcript.filter((r) => r.status === 'passed').map((r) => r.courseCode)));
const plannedCodes = computed(
  () => new Set(planner.activePlan?.items.filter((item) => item.status === 'selected').map((item) => item.courseCode) ?? []),
);

const suggestions = computed(() => {
  const rule = selectedNode.value?.rule;
  if (!rule) return [];
  return data.courses
    .filter((course) => matchesRule(rule, { courseCode: course.code, tags: course.tags }))
    .filter((course) => !passedCodes.value.has(course.code) && !plannedCodes.value.has(course.code))
    .map((course) => ({
      course,
      sections: data.sections.filter((section) => section.courseCode === course.code),
    }))
    .filter((item) => item.sections.length > 0)
    .slice(0, 6);
});

function addCourse(courseCode: string) {
  const result = planner.addCourse(courseCode);
  if (result.ok) toast('已加入当前方案', 'ok', { label: '去规划', run: () => { window.location.href = '/planner'; } });
  else if (result.conflict) toast('已加入，但与现有课程时间冲突', 'error');
  else toast('这门课已经在方案里了', 'info');
}

const statusText: Record<RequirementProgress['status'], string> = {
  met: '已满足',
  planned: '计划可覆盖',
  short: '仍有缺口',
};
</script>

<template>
  <div class="program">
    <header class="head">
      <div>
        <h1>培养方案</h1>
        <p class="sub">{{ data.program?.name }} · 共 {{ formatCredits(data.program?.totalCredits ?? 0) }} 学分</p>
      </div>
      <div class="head-actions">
        <span class="chip chip-accent">{{ totalPercent }}% 已覆盖</span>
        <router-link to="/planner" class="btn btn-sm">去规划</router-link>
      </div>
    </header>

    <section class="summary card">
      <div class="summary-bar">
        <div class="seg earned" :style="{ width: `${(progress!.totalEarned / progress!.totalRequired) * 100}%` }" />
        <div
          class="seg planned"
          :style="{ width: `${(progress!.totalPlanned / progress!.totalRequired) * 100}%` }"
        />
      </div>
      <div class="summary-legend">
        <span><i class="swatch earned" /> 已获 {{ formatCredits(progress?.totalEarned ?? 0) }}</span>
        <span><i class="swatch planned" /> 计划 {{ formatCredits(progress?.totalPlanned ?? 0) }}</span>
        <span><i class="swatch rest" /> 尚缺 {{ formatCredits(progress?.totalRemaining ?? 0) }}</span>
      </div>
      <p class="policy">
        <AppIcon name="info" :size="13" />
        {{ data.program ? '核算口径：' : '' }}指定课程 &gt; 标签匹配 &gt; 任意选修，一门课只计入一个模块；溢出学分不计入其他模块。
      </p>
    </section>

    <div class="layout">
      <section class="tree">
        <div v-for="module in progress?.modules ?? []" :key="module.nodeId" class="module card">
          <div class="module-head">
            <div class="module-title">
              <h3>{{ module.name }}</h3>
              <span class="module-num num">
                {{ formatCredits(module.earnedCredits + module.plannedCredits) }} / {{ formatCredits(module.requiredCredits) }}
              </span>
            </div>
            <RequirementBar :node="module" compact :show-numbers="false" hide-name />
          </div>
          <ul class="leaves">
            <li
              v-for="child in module.children ?? []"
              :key="child.nodeId"
              class="leaf"
              :class="{ active: child.nodeId === selectedNode?.id }"
              @click="selectedId = child.nodeId"
            >
              <RequirementBar :node="child" />
            </li>
            <li
              v-if="(module.children ?? []).length === 0"
              class="leaf"
              :class="{ active: module.nodeId === selectedNode?.id }"
              @click="selectedId = module.nodeId"
            >
              <RequirementBar :node="module" compact />
            </li>
          </ul>
        </div>
      </section>

      <aside v-if="selectedNode && selectedProgress" class="detail card">
        <div class="detail-head">
          <div>
            <span class="path">{{ selectedLeaf?.path.slice(0, -1).join(' / ') }}</span>
            <h2>{{ selectedNode.name }}</h2>
          </div>
          <span class="chip" :class="selectedProgress.status === 'met' ? 'chip-ok' : selectedProgress.status === 'planned' ? 'chip-accent' : 'chip-warn'">
            {{ statusText[selectedProgress.status] }}
          </span>
        </div>

        <div class="metrics">
          <div><span>要求</span><b class="num">{{ formatCredits(selectedProgress.requiredCredits) }}</b></div>
          <div><span>已获</span><b class="num">{{ formatCredits(selectedProgress.earnedCredits) }}</b></div>
          <div><span>计划</span><b class="num">{{ formatCredits(selectedProgress.plannedCredits) }}</b></div>
          <div><span>尚缺</span><b class="num danger">{{ formatCredits(Math.max(0, selectedProgress.requiredCredits - selectedProgress.earnedCredits - selectedProgress.plannedCredits)) }}</b></div>
        </div>

        <p v-if="selectedNode.note" class="note">{{ selectedNode.note }}</p>
        <p v-if="selectedNode.rule" class="rule">
          匹配规则：
          <template v-if="selectedNode.rule.kind === 'courseSet'">
            指定课程 {{ (selectedNode.rule.courseCodes ?? []).join('、') }}
          </template>
          <template v-else-if="selectedNode.rule.kind === 'tagSet'">
            课程标签含「{{ (selectedNode.rule.tags ?? []).join('・') }}」
          </template>
          <template v-else>任意课程</template>
        </p>

        <div class="section-label">已计入本模块</div>
        <ul v-if="selectedProgress.items.length > 0" class="items">
          <li v-for="item in selectedProgress.items" :key="`${item.courseCode}-${item.from}`">
            <span class="from" :class="item.from">{{ item.from === 'transcript' ? '已修' : '计划' }}</span>
            <span class="name">{{ item.courseName }}</span>
            <span class="mono">{{ item.courseCode }}</span>
            <span class="num credits">{{ formatCredits(item.credits) }}</span>
          </li>
        </ul>
        <p v-else class="empty">还没有课程计入这个模块。</p>

        <template v-if="suggestions.length > 0">
          <div class="section-label">可补足的课程</div>
          <ul class="suggest">
            <li v-for="item in suggestions" :key="item.course.code">
              <div class="suggest-main">
                <span class="name">{{ item.course.name }}</span>
                <span class="meta">
                  {{ item.course.credits }} 学分 · {{ item.course.department ?? '—' }}
                  <template v-if="item.sections[0]"> · {{ meetingText(item.sections[0]) }}</template>
                </span>
              </div>
              <button class="btn btn-sm" type="button" @click="addCourse(item.course.code)">
                <AppIcon name="plus" :size="13" /> 加入
              </button>
            </li>
          </ul>
        </template>
        <p v-else-if="selectedProgress.status !== 'met'" class="empty">课程库里暂时没有可补足这个模块的开课。</p>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.program {
  max-width: 1320px;
  margin: 0 auto;
}
.head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}
.sub {
  margin-top: 4px;
  font-size: 12.5px;
  color: var(--muted);
}
.head-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.summary {
  padding: 16px 18px;
  margin-bottom: 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.summary-bar {
  height: 14px;
  border-radius: 99px;
  background: var(--surface-3);
  overflow: hidden;
  display: flex;
}
.seg {
  height: 100%;
}
.earned {
  background: var(--ink);
}
.planned {
  background: repeating-linear-gradient(135deg, var(--accent-line) 0 4px, #ddd0fb 4px 8px);
}
.summary-legend {
  display: flex;
  gap: 18px;
  font-size: 11.5px;
  color: var(--muted);
}
.summary-legend span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.swatch {
  width: 9px;
  height: 9px;
  border-radius: 3px;
  display: inline-block;
}
.swatch.rest {
  background: var(--surface-3);
  border: 1px solid var(--line-strong);
}
.policy {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--faint);
}

.layout {
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(340px, 0.9fr);
  gap: 16px;
  align-items: start;
}

.tree {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.module {
  padding: 14px 16px;
}
.module-head {
  display: flex;
  flex-direction: column;
  gap: 7px;
  margin-bottom: 10px;
}
.module-title {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}
.module-title h3 {
  font-size: 13.5px;
}
.module-num {
  font-size: 11px;
  color: var(--muted);
}
.leaves {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.leaf {
  padding: 8px 10px;
  border-radius: 9px;
  cursor: pointer;
  transition: background 0.15s ease;
}
.leaf:hover {
  background: var(--surface-2);
}
.leaf.active {
  background: var(--accent-soft);
}

.detail {
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  position: sticky;
  top: 16px;
}
.detail-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}
.path {
  font-size: 10.5px;
  color: var(--faint);
}
.detail-head h2 {
  margin-top: 2px;
  font-size: 16px;
}
.metrics {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  padding: 10px;
  background: var(--surface-2);
  border-radius: 10px;
}
.metrics div {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.metrics span {
  font-size: 10.5px;
  color: var(--muted);
}
.metrics b {
  font-size: 15px;
  font-weight: 620;
}
.metrics .danger {
  color: var(--danger);
}
.note {
  font-size: 11.5px;
  color: var(--ink-2);
  background: var(--surface-2);
  padding: 8px 10px;
  border-radius: 8px;
  border-left: 2px solid var(--line-strong);
}
.rule {
  font-size: 11px;
  color: var(--muted);
}

.items,
.suggest {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.items li {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  padding: 5px 0;
  border-bottom: 1px dashed var(--line);
}
.items li:last-child {
  border-bottom: 0;
}
.items .name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.items .credits {
  color: var(--muted);
}
.from {
  font-size: 9.5px;
  padding: 1px 5px;
  border-radius: 4px;
  flex: none;
  background: var(--surface-3);
  color: var(--muted);
}
.from.transcript {
  background: var(--ok-soft);
  color: var(--ok);
}
.from.plan {
  background: var(--accent-soft);
  color: var(--accent-ink);
}

.suggest li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 10px;
  border: 1px solid var(--line);
  border-radius: 9px;
}
.suggest-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.suggest .name {
  font-size: 12.5px;
  font-weight: 550;
}
.suggest .meta {
  font-size: 10.5px;
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.empty {
  font-size: 11.5px;
  color: var(--faint);
}

@media (max-width: 1100px) {
  .layout {
    grid-template-columns: minmax(0, 1fr);
  }
  .detail {
    position: static;
  }
}
</style>
