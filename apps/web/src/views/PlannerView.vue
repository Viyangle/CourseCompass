<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import {
  flattenRequirements,
  formatCredits,
  matchesRule,
  patternToMask,
  type ConflictIssue,
  type CourseWithSections,
  type PlanItem,
  type Section,
} from '@planner/shared';
import { useDataStore } from '@/stores/data';
import { usePlannerStore } from '@/stores/planner';
import { progressLocal, type AnalysisDeps } from '@/utils/analyze';
import WeekGrid from '@/components/WeekGrid.vue';
import CourseCard from '@/components/CourseCard.vue';
import RequirementBar from '@/components/RequirementBar.vue';
import AppIcon from '@/components/AppIcon.vue';
import { toast } from '@/composables/toast';
import { api } from '@/api/client';
import { meetingText } from '@/utils/format';

const data = useDataStore();
const planner = usePlannerStore();

const keyword = ref('');
const onlyGap = ref(false);
const onlyFree = ref(false);
const categoryFilter = ref('all');
const creating = ref(false);
const newPlanName = ref('');
const detailItemId = ref<string | null>(null);
const busy = ref(false);
const showWeekend = ref(false);

const deps = computed<AnalysisDeps>(() => ({
  program: data.program,
  transcript: data.transcript,
  courses: data.courses,
  sections: data.allSections,
  weekCount: data.planningTerm?.weekCount ?? 20,
  creditCap: 30,
}));

const analysis = computed(() => planner.analysis);
const progress = computed(() => progressLocal(planner.activePlan, deps.value));

const passedCodes = computed(() => new Set(data.transcript.filter((r) => r.status === 'passed').map((r) => r.courseCode)));

/**
 * 课程号 → 教学班。
 * 真实数据有 3000+ 教学班、2000 门课；如果每门课都 filter 一遍，单次筛选就是 600 万次比较，
 * 输入搜索词时界面会直接卡住。这里预先分桶，把复杂度降到 O(n)。
 */
const sectionsByCourse = computed(() => {
  const map = new Map<string, typeof data.sections>();
  for (const section of data.sections) {
    if (section.termId !== data.planningTermId) continue;
    const list = map.get(section.courseCode);
    if (list) list.push(section);
    else map.set(section.courseCode, [section]);
  }
  return map;
});

/** 真正还缺（计划也没覆盖）的模块 id */
const shortNodeIds = computed(() => {
  const ids = new Set<string>();
  if (!progress.value) return ids;
  const walk = (nodes: typeof progress.value.modules) => {
    for (const node of nodes) {
      if (node.children?.length) walk(node.children);
      else if (node.status === 'short') ids.add(node.nodeId);
    }
  };
  walk(progress.value.modules);
  return ids;
});

const gapCourseCodes = computed(() => {
  const codes = new Set<string>();
  const program = data.program;
  if (!program) return codes;
  for (const leaf of flattenRequirements(program.modules)) {
    if (!shortNodeIds.value.has(leaf.node.id) || !leaf.node.rule) continue;
    for (const course of data.courses) {
      if (passedCodes.value.has(course.code)) continue;
      if (matchesRule(leaf.node.rule, { courseCode: course.code, tags: course.tags })) codes.add(course.code);
    }
  }
  return codes;
});

const planSections = computed(() => {
  const plan = planner.activePlan;
  if (!plan) return [];
  return plan.items
    .filter((item) => item.status === 'selected')
    .map((item) => data.sectionById.get(item.sectionId))
    .filter((section): section is NonNullable<typeof section> => Boolean(section));
});

function sectionIsFree(courseCode: string): boolean {
  const sections = sectionsByCourse.value.get(courseCode) ?? [];
  if (sections.length === 0) return false;
  return sections.some((section) =>
    section.meetings.every((meeting) =>
      planSections.value.every((existing) =>
        existing.meetings.every((other) => {
          if (meeting.day !== other.day) return true;
          if (Math.max(meeting.startPeriod, other.startPeriod) > Math.min(meeting.endPeriod, other.endPeriod)) return true;
          return (patternToMask(meeting.weeks) & patternToMask(other.weeks)) === 0;
        }),
      ),
    ),
  );
}

const catalogItems = computed<CourseWithSections[]>(() => {
  const q = keyword.value.trim().toLowerCase();
  const out: CourseWithSections[] = [];

  for (const course of data.courses) {
    const sections = sectionsByCourse.value.get(course.code) ?? [];
    if (sections.length === 0) continue;
    if (q) {
      const hay = [course.name, course.code, course.department ?? '', ...sections.flatMap((s) => s.teachers)]
        .join(' ')
        .toLowerCase();
      if (!hay.includes(q)) continue;
    }
    if (categoryFilter.value !== 'all' && course.category !== categoryFilter.value) continue;
    if (onlyGap.value && !gapCourseCodes.value.has(course.code)) continue;
    if (onlyFree.value && !sectionIsFree(course.code)) continue;
    const inPlan = planner.activePlan?.items.some((item) => item.courseCode === course.code) ?? false;
    out.push({
      course,
      sections,
      requirementIds: [],
      state: inPlan ? 'in-plan' : passedCodes.value.has(course.code) ? 'passed' : 'available',
    });
  }

  out.sort((a, b) => {
    const gapA = gapCourseCodes.value.has(a.course.code) ? 1 : 0;
    const gapB = gapCourseCodes.value.has(b.course.code) ? 1 : 0;
    if (gapA !== gapB) return gapB - gapA;
    return a.course.code.localeCompare(b.course.code);
  });
  return out;
});

const categories = computed(() => [...new Set(data.courses.map((course) => course.category))]);

/** 课程池一次最多渲染 80 张卡：2000 张卡会让主线程卡死，且用户也不会真的翻到底。 */
const POOL_LIMIT = 80;
const visibleCourses = computed(() => catalogItems.value.slice(0, POOL_LIMIT));

const weekOptions = computed(() => Array.from({ length: data.planningTerm?.weekCount ?? 20 }, (_, index) => index + 1));

const detailItem = computed(() => {
  const plan = planner.activePlan;
  if (!plan || !detailItemId.value) return null;
  const item = plan.items.find((entry) => entry.id === detailItemId.value);
  if (!item) return null;
  const section = data.sectionById.get(item.sectionId);
  const course = data.courses.find((entry) => entry.code === item.courseCode);
  return item && section && course ? { item, section, course } : null;
});

/** 没有排课时间的课程（线上/自由时间）不会出现在网格里，单独列出来，避免"加了却看不见"。 */
const noMeetingItems = computed(() =>
  (planner.activePlan?.items ?? [])
    .filter((item) => item.status === 'selected')
    .map((item) => ({ item, section: data.sectionById.get(item.sectionId) }))
    .filter((entry): entry is { item: PlanItem; section: Section } => Boolean(entry.section) && entry.section!.meetings.length === 0),
);

const conflictGroups = computed(() => {
  const issues = analysis.value?.conflicts ?? [];
  return {
    errors: issues.filter((issue) => issue.severity === 'error'),
    warnings: issues.filter((issue) => issue.severity === 'warning'),
    infos: issues.filter((issue) => issue.severity === 'info'),
  };
});

const unmetModules = computed(() => {
  if (!progress.value) return [];
  const leaves: typeof progress.value.modules = [];
  const walk = (nodes: typeof progress.value.modules) => {
    for (const node of nodes) {
      if (node.children?.length) walk(node.children);
      else if (node.status !== 'met') leaves.push(node);
    }
  };
  walk(progress.value.modules);
  return leaves.sort(
    (a, b) =>
      Math.max(0, b.requiredCredits - b.earnedCredits - b.plannedCredits) -
      Math.max(0, a.requiredCredits - a.earnedCredits - a.plannedCredits),
  ).slice(0, 5);
});

const saveLabel = computed(() => {
  if (planner.saveState === 'saving') return '保存中…';
  if (planner.saveState === 'error') return '保存失败';
  return '已保存';
});

function addCourse(code: string) {
  const result = planner.addCourse(code);
  if (result.ok) {
    if (result.conflict) toast('已加入，但与现有课程时间冲突', 'error');
    else toast('已加入方案', 'ok');
  } else toast('这门课已经在方案里了', 'info');
}

async function createPlan() {
  const name = newPlanName.value.trim();
  if (!name) return;
  const result = await api.createPlan({ name });
  data.upsertPlan(result.plan);
  planner.setActive(result.plan.id);
  creating.value = false;
  newPlanName.value = '';
  toast('已创建新方案', 'ok');
}

async function duplicatePlan() {
  if (!planner.activePlan) return;
  const result = await api.duplicatePlan(planner.activePlan.id);
  data.upsertPlan(result.plan);
  planner.setActive(result.plan.id);
  toast('已复制当前方案', 'ok');
}

async function renamePlan() {
  const plan = planner.activePlan;
  if (!plan) return;
  const name = window.prompt('方案名称', plan.name)?.trim();
  if (!name || name === plan.name) return;
  const result = await api.updatePlan(plan.id, { name });
  data.upsertPlan(result.plan);
}

async function deletePlan() {
  const plan = planner.activePlan;
  if (!plan) return;
  if (!window.confirm(`删除「${plan.name}」？此操作不可撤销。`)) return;
  await api.deletePlan(plan.id);
  data.removePlan(plan.id);
  planner.setActive(data.plans[0]?.id ?? '');
  toast('方案已删除', 'info');
}

function removeItem(itemId: string) {
  planner.removeItem(itemId);
  detailItemId.value = null;
  toast('已移出方案', 'info', { label: '撤销', run: () => planner.undo() });
}

function toggleBackup(itemId: string) {
  planner.toggleStatus(itemId);
  detailItemId.value = null;
}

function onSelectItem(itemId: string) {
  detailItemId.value = detailItemId.value === itemId ? null : itemId;
}

function onDropCourse(code: string) {
  addCourse(code);
}

async function exportAs(format: 'md' | 'csv' | 'ics') {
  if (!planner.activePlan) return;
  busy.value = true;
  try {
    const url = api.exportUrl(planner.activePlan.id, format);
    const response = await fetch(url, { credentials: 'same-origin' });
    if (!response.ok) throw new Error('导出失败');
    const blob = await response.blob();
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${planner.activePlan.name}.${format}`;
    link.click();
    URL.revokeObjectURL(link.href);
  } catch {
    toast('导出失败，请确认后端已启动', 'error');
  } finally {
    busy.value = false;
  }
}

function onKeydown(event: KeyboardEvent) {
  const target = event.target as HTMLElement | null;
  if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
    event.preventDefault();
    if (event.shiftKey) planner.redo();
    else planner.undo();
  }
  if (event.key === 'Escape') detailItemId.value = null;
}

onMounted(() => window.addEventListener('keydown', onKeydown));
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown));

function issueTone(issue: ConflictIssue) {
  if (issue.severity === 'error') return 'error';
  if (issue.severity === 'warning') return 'warn';
  return 'info';
}
function issueIcon(issue: ConflictIssue): 'alert' | 'info' {
  return issue.severity === 'error' ? 'alert' : 'info';
}
</script>

<template>
  <div class="planner">
    <header class="head">
      <div class="tabs">
        <button
          v-for="plan in data.plans"
          :key="plan.id"
          type="button"
          class="plan-tab"
          :class="{ active: plan.id === planner.activePlan?.id }"
          @click="planner.setActive(plan.id)"
        >
          <span class="tab-dot" :style="{ background: plan.color ?? 'var(--accent)' }" />
          {{ plan.name }}
        </button>
        <input
          v-if="creating"
          v-model="newPlanName"
          class="input new-plan"
          placeholder="方案名称，回车创建"
          autofocus
          @keydown.enter="createPlan"
          @keydown.esc="creating = false"
          @blur="creating = false"
        />
        <button v-else type="button" class="add-plan" title="新建方案" @click="creating = true">
          <AppIcon name="plus" :size="14" />
        </button>
      </div>

      <div class="head-actions">
        <span class="save-state" :class="planner.saveState">{{ saveLabel }}</span>
        <button class="btn btn-sm" type="button" :disabled="!planner.canUndo" title="撤销 (Ctrl+Z)" @click="planner.undo()">
          <AppIcon name="undo" :size="14" />
        </button>
        <button class="btn btn-sm" type="button" :disabled="!planner.canRedo" title="重做" @click="planner.redo()">
          <AppIcon name="redo" :size="14" />
        </button>
        <div class="export">
          <button class="btn btn-sm" type="button" :disabled="busy">导出 <AppIcon name="chevronDown" :size="12" /></button>
          <div class="export-menu">
            <button type="button" @click="exportAs('md')">Markdown 清单</button>
            <button type="button" @click="exportAs('csv')">CSV 表格</button>
            <button type="button" @click="exportAs('ics')">日历（.ics）</button>
          </div>
        </div>
        <button class="btn btn-sm" type="button" @click="duplicatePlan">复制</button>
        <button class="btn btn-sm" type="button" @click="renamePlan">重命名</button>
        <button class="btn btn-sm btn-danger" type="button" @click="deletePlan">删除</button>
      </div>
    </header>

    <div class="workspace">
      <aside class="pool">
        <div class="pool-head">
          <div class="row">
            <input v-model="keyword" class="input" placeholder="搜索课程名 / 代码 / 教师" />
          </div>
          <div class="filters">
            <button type="button" class="toggle" :class="{ on: onlyGap }" @click="onlyGap = !onlyGap">
              只补缺口
            </button>
            <button type="button" class="toggle" :class="{ on: onlyFree }" @click="onlyFree = !onlyFree">
              无冲突
            </button>
            <select v-model="categoryFilter" class="select mini-select">
              <option value="all">全部类别</option>
              <option v-for="category in categories" :key="category" :value="category">{{ category }}</option>
            </select>
          </div>
          <p class="pool-meta">
            {{ catalogItems.length }} 门开课 · {{ data.planningTerm?.name }}
            <span v-if="gapCourseCodes.size > 0" class="chip chip-ok">{{ gapCourseCodes.size }} 门可补缺口</span>
          </p>
        </div>

        <div class="pool-list">
          <CourseCard
            v-for="entry in visibleCourses"
            :key="entry.course.code"
            :course="entry.course"
            :sections="entry.sections"
            :state="entry.state"
            :gap="gapCourseCodes.has(entry.course.code)"
            dense
            @add="addCourse"
          />
          <p v-if="catalogItems.length > visibleCourses.length" class="pool-more">
            还有 {{ catalogItems.length - visibleCourses.length }} 门未显示 —— 用搜索或「只补缺口」缩小范围。
          </p>
          <p v-if="catalogItems.length === 0" class="pool-empty">没有符合条件的课程。</p>
        </div>
      </aside>

      <section class="board">
        <div class="board-head">
          <div class="week-picker">
            <button type="button" class="week-btn" :class="{ on: planner.week === 0 }" @click="planner.setWeek(0)">
              全部周
            </button>
            <div class="weeks">
              <button
                v-for="week in weekOptions"
                :key="week"
                type="button"
                class="week-btn num"
                :class="{ on: planner.week === week }"
                @click="planner.setWeek(week)"
              >
                {{ week }}
              </button>
            </div>
          </div>
          <div class="board-meta">
            <button type="button" class="week-btn weekend-toggle" :class="{ on: showWeekend }" @click="showWeekend = !showWeekend">
              周末
            </button>
            <span v-if="planner.week > 0" class="chip chip-accent">第 {{ planner.week }} 周</span>
          </div>
        </div>

        <WeekGrid
          :items="planner.activePlan?.items ?? []"
          :sections="data.allSections"
          :courses="data.courses"
          :periods="data.periods"
          :week="planner.week"
          :conflicts="analysis?.conflicts ?? []"
          :show-weekend="showWeekend"
          @select="onSelectItem"
          @drop-course="onDropCourse"
        />

        <div v-if="noMeetingItems.length > 0" class="floating">
          <span class="section-label">无固定上课时间</span>
          <span v-for="entry in noMeetingItems" :key="entry.item.id" class="backup-chip">
            {{ data.courses.find((course) => course.code === entry.item.courseCode)?.name ?? entry.item.courseCode }}
            <button type="button" title="移除" @click="removeItem(entry.item.id)">
              <AppIcon name="close" :size="12" />
            </button>
          </span>
        </div>

        <div class="backup">
          <div class="backup-head">
            <span class="section-label">备选（不计入课表）</span>
            <span class="faint">{{ planner.backupItems.length }} 门</span>
          </div>
          <div class="backup-list">
            <div v-for="item in planner.backupItems" :key="item.id" class="backup-chip">
              <span>{{ data.courses.find((course) => course.code === item.courseCode)?.name ?? item.courseCode }}</span>
              <button type="button" title="转为正式" @click="planner.toggleStatus(item.id)">
                <AppIcon name="check" :size="12" />
              </button>
              <button type="button" title="移除" @click="removeItem(item.id)">
                <AppIcon name="close" :size="12" />
              </button>
            </div>
            <p v-if="planner.backupItems.length === 0" class="faint small">
              把课程卡片拖到课表下方，或在这里管理「想选但还没定」的课。
            </p>
          </div>
        </div>
      </section>

      <aside class="ledger">
        <section class="ledger-card card">
          <div class="ledger-top">
            <div>
              <span class="section-label">本学期计划</span>
              <div class="big num">{{ formatCredits(analysis?.metrics.totalCredits ?? 0) }} <small>学分</small></div>
            </div>
            <div class="ledger-stats">
              <div><span>门数</span><b class="num">{{ analysis?.metrics.courseCount ?? 0 }}</b></div>
              <div><span>到校</span><b class="num">{{ analysis?.metrics.activeDays.length ?? 0 }} 天</b></div>
              <div><span>周课时</span><b class="num">{{ analysis?.metrics.weeklyPeriods ?? 0 }}</b></div>
            </div>
          </div>
          <div class="load-row">
            <span class="faint">空档 {{ analysis?.metrics.gapPeriods ?? 0 }} 节</span>
            <span class="faint" v-if="analysis?.metrics.latestPeriod">
              最晚第 {{ analysis?.metrics.latestPeriod }} 节
            </span>
            <span class="faint">平均 {{ formatCredits(analysis?.metrics.weeklyPeriods ?? 0) }} 节/周</span>
          </div>
        </section>

        <section class="ledger-card card">
          <div class="row-between">
            <h3>冲突与提醒</h3>
            <span class="chip" :class="(analysis?.metrics.conflictCount ?? 0) > 0 ? 'chip-danger' : 'chip-ok'">
              {{ analysis?.metrics.conflictCount ?? 0 }} 冲突
            </span>
          </div>
          <ul v-if="(analysis?.conflicts.length ?? 0) > 0" class="issues">
            <li v-for="issue in analysis?.conflicts" :key="issue.id" :class="issueTone(issue)">
              <AppIcon :name="issueIcon(issue)" :size="13" />
              <span>{{ issue.message }}</span>
            </li>
          </ul>
          <p v-else class="empty-ok"><AppIcon name="check" :size="13" /> 没有发现时间冲突。</p>
        </section>

        <section class="ledger-card card">
          <div class="row-between">
            <h3>缺口进度</h3>
            <router-link to="/program" class="mini-link">详情</router-link>
          </div>
          <div class="mini-reqs">
            <RequirementBar v-for="node in unmetModules" :key="node.nodeId" :node="node" compact />
            <p v-if="unmetModules.length === 0" class="faint small">所有模块都已满足。</p>
          </div>
        </section>
      </aside>
    </div>

    <transition name="fade">
      <div v-if="detailItem" class="drawer">
        <div class="drawer-head">
          <div>
            <span class="path">{{ detailItem.course.category }} · {{ detailItem.course.code }}</span>
            <h2>{{ detailItem.course.name }}</h2>
          </div>
          <button type="button" class="icon-btn" @click="detailItemId = null"><AppIcon name="close" :size="16" /></button>
        </div>
        <div class="drawer-body">
          <dl>
            <div><dt>学分</dt><dd class="num">{{ detailItem.course.credits }}</dd></div>
            <div><dt>教学班</dt><dd>{{ detailItem.section.classNo }}</dd></div>
            <div><dt>教师</dt><dd>{{ detailItem.section.teachers.join('、') || '待定' }}</dd></div>
            <div><dt>时间</dt><dd>{{ meetingText(detailItem.section) }}</dd></div>
            <div><dt>地点</dt><dd>{{ detailItem.section.meetings[0]?.location ?? detailItem.section.campus ?? '—' }}</dd></div>
            <div><dt>考核</dt><dd>{{ detailItem.course.assessment ?? '—' }}</dd></div>
            <div v-if="detailItem.course.description"><dt>简介</dt><dd class="desc">{{ detailItem.course.description }}</dd></div>
          </dl>
          <div class="drawer-actions">
            <button class="btn" type="button" @click="toggleBackup(detailItem.item.id)">
              {{ detailItem.item.status === 'backup' ? '转为正式课程' : '移入备选' }}
            </button>
            <button class="btn btn-danger" type="button" @click="removeItem(detailItem.item.id)">移出方案</button>
          </div>
        </div>
      </div>
    </transition>
  </div>
</template>

<style scoped>
.planner {
  display: flex;
  flex-direction: column;
  gap: 14px;
  height: calc(100vh - var(--topbar) - 74px);
  min-height: 560px;
}

.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex: none;
}
.tabs {
  display: flex;
  align-items: center;
  gap: 4px;
  overflow-x: auto;
  padding-bottom: 2px;
}
.plan-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 11px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  font-size: 12.5px;
  color: var(--muted);
  cursor: pointer;
  white-space: nowrap;
}
.plan-tab:hover {
  background: var(--surface-3);
}
.plan-tab.active {
  background: var(--surface);
  border-color: var(--line);
  color: var(--ink);
  font-weight: 600;
  box-shadow: var(--shadow-sm);
}
.tab-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
}
.add-plan {
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  border: 1px dashed var(--line-strong);
  background: transparent;
  border-radius: 8px;
  color: var(--muted);
  cursor: pointer;
}
.add-plan:hover {
  color: var(--accent-ink);
  border-color: var(--accent-line);
}
.new-plan {
  width: 180px;
  height: 30px;
}
.head-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: none;
}
.save-state {
  font-size: 11px;
  color: var(--faint);
  margin-right: 4px;
}
.save-state.saving {
  color: var(--warn);
}
.save-state.error {
  color: var(--danger);
}
.export {
  position: relative;
}
.export-menu {
  position: absolute;
  right: 0;
  top: 34px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 9px;
  box-shadow: var(--shadow-md);
  padding: 4px;
  display: none;
  z-index: 30;
  min-width: 140px;
}
.export:hover .export-menu {
  display: block;
}
.export-menu button {
  display: block;
  width: 100%;
  text-align: left;
  padding: 7px 9px;
  border: 0;
  background: none;
  border-radius: 6px;
  font-size: 12px;
  cursor: pointer;
}
.export-menu button:hover {
  background: var(--surface-3);
}

.workspace {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 274px minmax(0, 1fr) 286px;
  gap: 14px;
}

.pool,
.board,
.ledger {
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.pool {
  background: var(--surface-2);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 12px;
}
.pool-head {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.filters {
  display: flex;
  gap: 5px;
  flex-wrap: wrap;
}
.toggle {
  height: 24px;
  padding: 0 8px;
  border-radius: 6px;
  border: 1px solid var(--line-strong);
  background: var(--surface);
  font-size: 11px;
  color: var(--muted);
  cursor: pointer;
}
.toggle.on {
  background: var(--accent-soft);
  border-color: var(--accent-line);
  color: var(--accent-ink);
  font-weight: 600;
}
.mini-select {
  height: 24px;
  width: auto;
  font-size: 11px;
  padding: 0 4px;
}
.pool-meta {
  font-size: 10.5px;
  color: var(--faint);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  flex-wrap: wrap;
  line-height: 1.5;
}
.pool-list {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-right: 2px;
  margin-right: -4px;
}
.pool-empty {
  font-size: 12px;
  color: var(--faint);
  padding: 12px 4px;
}
.pool-more {
  font-size: 10.5px;
  color: var(--faint);
  line-height: 1.5;
  padding: 6px 4px 10px;
}

.board {
  overflow-y: auto;
}
.board-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.week-picker {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.weeks {
  display: flex;
  gap: 2px;
  overflow-x: auto;
}
.week-btn {
  height: 24px;
  min-width: 24px;
  padding: 0 6px;
  border: 1px solid transparent;
  background: transparent;
  border-radius: 6px;
  font-size: 11px;
  color: var(--muted);
  cursor: pointer;
  flex: none;
}
.week-btn:hover {
  background: var(--surface-3);
}
.week-btn.on {
  background: var(--surface);
  border-color: var(--line-strong);
  color: var(--ink);
  font-weight: 600;
}
.board-meta {
  flex: none;
  display: flex;
  align-items: center;
  gap: 6px;
}
.weekend-toggle {
  border: 1px solid var(--line-strong);
}
.weekend-toggle.on {
  background: var(--accent-soft);
  border-color: var(--accent-line);
  color: var(--accent-ink);
}

.backup {
  border: 1px dashed var(--line-strong);
  border-radius: var(--radius);
  padding: 10px 12px;
  background: var(--surface-2);
  min-height: 72px;
}
.floating {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 8px 12px;
  border: 1px dashed var(--line-strong);
  border-radius: var(--radius);
  background: var(--surface-2);
}
.backup-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}
.backup-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.backup-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px 4px 9px;
  border-radius: 99px;
  background: var(--surface);
  border: 1px solid var(--line);
  font-size: 11.5px;
}
.backup-chip button {
  width: 18px;
  height: 18px;
  border: 0;
  background: var(--surface-3);
  border-radius: 50%;
  display: grid;
  place-items: center;
  cursor: pointer;
  color: var(--muted);
}
.backup-chip button:hover {
  background: var(--accent-soft);
  color: var(--accent-ink);
}
.small {
  font-size: 11px;
}

.ledger {
  overflow-y: auto;
}
.ledger-card {
  padding: 13px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.ledger-top {
  display: flex;
  justify-content: space-between;
  gap: 10px;
}
.big {
  font-size: 30px;
  font-weight: 660;
  letter-spacing: -0.03em;
  line-height: 1.15;
}
.big small {
  font-size: 12px;
  font-weight: 500;
  color: var(--muted);
}
.ledger-stats {
  display: flex;
  flex-direction: column;
  gap: 3px;
  align-items: flex-end;
  font-size: 11px;
  color: var(--muted);
}
.ledger-stats div {
  display: flex;
  gap: 6px;
}
.ledger-stats b {
  color: var(--ink);
  font-weight: 600;
}
.load-row {
  display: flex;
  justify-content: space-between;
  font-size: 10.5px;
  border-top: 1px dashed var(--line);
  padding-top: 8px;
}

.issues {
  display: flex;
  flex-direction: column;
  gap: 7px;
  max-height: 240px;
  overflow-y: auto;
}
.issues li {
  display: flex;
  gap: 7px;
  font-size: 11.5px;
  line-height: 1.5;
  padding: 7px 8px;
  border-radius: 8px;
  background: var(--surface-2);
  color: var(--ink-2);
}
.issues li svg {
  flex: none;
  margin-top: 2px;
}
.issues li.error {
  background: var(--danger-soft);
  color: color-mix(in srgb, var(--danger) 85%, black);
}
.issues li.warn {
  background: var(--warn-soft);
  color: color-mix(in srgb, var(--warn) 90%, black);
}
.issues li.info {
  background: var(--info-soft);
  color: color-mix(in srgb, var(--info) 90%, black);
}
.empty-ok {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11.5px;
  color: var(--ok);
}
.mini-reqs {
  display: flex;
  flex-direction: column;
  gap: 9px;
}
.mini-link {
  font-size: 11px;
  color: var(--accent-ink);
}

.drawer {
  position: fixed;
  right: 22px;
  bottom: 22px;
  width: 360px;
  max-width: calc(100vw - 44px);
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  z-index: 40;
  overflow: hidden;
}
.drawer-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  padding: 14px 16px 10px;
  border-bottom: 1px solid var(--line);
}
.path {
  font-size: 10.5px;
  color: var(--faint);
}
.drawer-head h2 {
  font-size: 15px;
  margin-top: 2px;
}
.icon-btn {
  width: 26px;
  height: 26px;
  display: grid;
  place-items: center;
  border: 0;
  background: var(--surface-3);
  border-radius: 7px;
  cursor: pointer;
  color: var(--muted);
}
.drawer-body {
  padding: 12px 16px 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
dl {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 7px;
  font-size: 12px;
}
dl div {
  display: flex;
  gap: 10px;
}
dt {
  width: 44px;
  flex: none;
  color: var(--muted);
}
dd {
  margin: 0;
}
.desc {
  color: var(--ink-2);
  line-height: 1.6;
  font-size: 11.5px;
}
.drawer-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

@media (max-width: 1240px) {
  .workspace {
    grid-template-columns: 250px minmax(0, 1fr);
  }
  .ledger {
    display: none;
  }
}
</style>
