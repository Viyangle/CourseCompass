<script setup lang="ts">
import { computed, ref } from 'vue';
import {
  flattenRequirements,
  matchesRule,
  patternToMask,
  type Course,
  type Section,
} from '@planner/shared';
import { useDataStore } from '@/stores/data';
import { usePlannerStore } from '@/stores/planner';
import { progressLocal, type AnalysisDeps } from '@/utils/analyze';
import AppIcon from '@/components/AppIcon.vue';
import { categoryColor, meetingText, teachersText } from '@/utils/format';
import { toast } from '@/composables/toast';

const data = useDataStore();
const planner = usePlannerStore();

const keyword = ref('');
const category = ref('all');
const minCredits = ref(0);
const weekday = ref(0);
const onlyGap = ref(false);
const onlyFree = ref(false);
const compareCodes = ref<string[]>([]);

const deps = computed<AnalysisDeps>(() => ({
  program: data.program,
  transcript: data.transcript,
  courses: data.courses,
  sections: data.allSections,
  weekCount: data.planningTerm?.weekCount ?? 20,
}));

const progress = computed(() => progressLocal(planner.activePlan, deps.value));
const passedCodes = computed(() => new Set(data.transcript.filter((r) => r.status === 'passed').map((r) => r.courseCode)));

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

function coversGap(course: Course): boolean {
  if (!data.program) return false;
  return flattenRequirements(data.program.modules).some(
    (leaf) => shortNodeIds.value.has(leaf.node.id) && leaf.node.rule && matchesRule(leaf.node.rule, { courseCode: course.code, tags: course.tags }),
  );
}

const planSections = computed(() =>
  (planner.activePlan?.items ?? [])
    .filter((item) => item.status === 'selected')
    .map((item) => data.sectionById.get(item.sectionId))
    .filter((section): section is Section => Boolean(section)),
);

function sectionsOf(code: string): Section[] {
  return sectionsByCourse.value.get(code) ?? [];
}

/** 课程号 → 教学班，避免每门课都遍历 3000+ 教学班。 */
const sectionsByCourse = computed(() => {
  const map = new Map<string, Section[]>();
  for (const section of data.sections) {
    if (section.termId !== data.planningTermId) continue;
    const list = map.get(section.courseCode);
    if (list) list.push(section);
    else map.set(section.courseCode, [section]);
  }
  return map;
});

function isFree(code: string): boolean {
  const sections = sectionsOf(code);
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

interface Row {
  course: Course;
  sections: Section[];
  gap: boolean;
  free: boolean;
  inPlan: boolean;
}

const rows = computed<Row[]>(() => {
  const q = keyword.value.trim().toLowerCase();
  const out: Row[] = [];
  for (const course of data.courses) {
    const sections = sectionsOf(course.code);
    if (sections.length === 0) continue;
    if (q) {
      const hay = [course.name, course.code, course.department ?? '', ...sections.flatMap((s) => s.teachers)]
        .join(' ')
        .toLowerCase();
      if (!hay.includes(q)) continue;
    }
    if (category.value !== 'all' && course.category !== category.value) continue;
    if (course.credits < minCredits.value) continue;
    if (weekday.value > 0 && !sections.some((s) => s.meetings.some((m) => m.day === weekday.value))) continue;
    const gap = coversGap(course);
    if (onlyGap.value && !gap) continue;
    const free = isFree(course.code);
    if (onlyFree.value && !free) continue;
    out.push({
      course,
      sections,
      gap,
      free,
      inPlan: (planner.activePlan?.items ?? []).some((item) => item.courseCode === course.code),
    });
  }
  out.sort((a, b) => Number(b.gap) - Number(a.gap) || a.course.code.localeCompare(b.course.code));
  return out;
});

const categories = computed(() => [...new Set(data.courses.map((course) => course.category))]);

/** 一次渲染 120 行；真实课程库有近 2000 门，全量 DOM 会明显掉帧。 */
const visibleLimit = ref(120);
const visibleRows = computed(() => rows.value.slice(0, visibleLimit.value));
const compareCourses = computed(() =>
  compareCodes.value.map((code) => data.courses.find((course) => course.code === code)).filter((c): c is Course => Boolean(c)),
);

const compareGridStyle = computed(() => ({
  gridTemplateColumns: `80px repeat(${Math.max(comparedFields.value.length, 1)}, minmax(0, 1fr))`,
}));

const comparedFields = computed(() =>
  compareCourses.value.map((course) => {
    const sections = sectionsOf(course.code);
    return {
      course,
      sections,
      fields: [
        { label: '学分', value: `${course.credits}` },
        { label: '类别', value: course.category },
        { label: '院系', value: course.department ?? '—' },
        { label: '教师', value: sections.map((s) => teachersText(s)).join(' / ') || '待定' },
        { label: '时间', value: sections.map((s) => meetingText(s)).join('；') || '—' },
        { label: '教学班', value: `${sections.length} 个` },
        { label: '考核', value: course.assessment ?? '—' },
        { label: '简介', value: course.description ?? '—' },
      ],
    };
  }),
);

function toggleCompare(code: string) {
  const index = compareCodes.value.indexOf(code);
  if (index >= 0) compareCodes.value.splice(index, 1);
  else if (compareCodes.value.length >= 4) toast('最多同时对比 4 门课', 'info');
  else compareCodes.value.push(code);
}

function add(course: Course) {
  const result = planner.addCourse(course.code);
  if (result.ok) toast(result.conflict ? '已加入，但存在时间冲突' : `已加入《${course.name}》`, result.conflict ? 'error' : 'ok');
  else toast('这门课已经在方案里了', 'info');
}
</script>

<template>
  <div class="courses">
    <header class="head">
      <div>
        <h1>课程库</h1>
        <p class="sub">{{ data.planningTerm?.name }} 开课 · 共 {{ rows.length }} 门</p>
      </div>
      <div class="legend">
        <span class="chip chip-ok">可补缺口</span>
        <span class="chip chip-danger">与方案冲突</span>
        <span class="chip chip-accent">已在方案</span>
      </div>
    </header>

    <section class="filters card">
      <input v-model="keyword" class="input search" placeholder="搜索课程名 / 代码 / 教师 / 院系" />
      <select v-model="category" class="select">
        <option value="all">全部类别</option>
        <option v-for="item in categories" :key="item" :value="item">{{ item }}</option>
      </select>
      <select v-model.number="minCredits" class="select">
        <option :value="0">学分不限</option>
        <option :value="2">≥ 2 学分</option>
        <option :value="3">≥ 3 学分</option>
        <option :value="4">≥ 4 学分</option>
      </select>
      <select v-model.number="weekday" class="select">
        <option :value="0">星期不限</option>
        <option v-for="day in 7" :key="day" :value="day">周{{ ['一', '二', '三', '四', '五', '六', '日'][day - 1] }}</option>
      </select>
      <button type="button" class="toggle" :class="{ on: onlyGap }" @click="onlyGap = !onlyGap">
        <AppIcon name="spark" :size="12" /> 只补缺口
      </button>
      <button type="button" class="toggle" :class="{ on: onlyFree }" @click="onlyFree = !onlyFree">
        <AppIcon name="check" :size="12" /> 无冲突
      </button>
    </section>

    <div class="table card">
      <div class="thead">
        <span class="col-name">课程</span>
        <span class="col-credits">学分</span>
        <span class="col-teacher">教师</span>
        <span class="col-time">时间</span>
        <span class="col-state">状态</span>
        <span class="col-actions" />
      </div>
      <div class="tbody">
        <div v-for="row in visibleRows" :key="row.course.code" class="trow">
          <div class="col-name">
            <span class="dot" :style="{ background: categoryColor(row.course.category) }" />
            <div class="name-wrap">
              <span class="name">{{ row.course.name }}</span>
              <span class="meta">
                <span class="mono">{{ row.course.code }}</span> · {{ row.course.category }}
                <template v-if="row.sections.length > 1"> · {{ row.sections.length }} 个教学班</template>
              </span>
            </div>
          </div>
          <span class="col-credits num">{{ row.course.credits }}</span>
          <span class="col-teacher">{{ row.sections[0] ? teachersText(row.sections[0]) : '—' }}</span>
          <span class="col-time">{{ row.sections[0] ? meetingText(row.sections[0]) : '—' }}</span>
          <span class="col-state">
            <span v-if="row.inPlan" class="chip chip-accent">已在方案</span>
            <span v-else-if="passedCodes.has(row.course.code)" class="chip">已修</span>
            <span v-else-if="!row.free" class="chip chip-danger">冲突</span>
            <span v-else-if="row.gap" class="chip chip-ok">补缺口</span>
            <span v-else class="chip">可选</span>
          </span>
          <span class="col-actions">
            <button class="btn btn-sm" type="button" :class="{ 'btn-primary': compareCodes.includes(row.course.code) }" @click="toggleCompare(row.course.code)">
              对比
            </button>
            <button class="btn btn-sm" type="button" :disabled="row.inPlan" @click="add(row.course)">
              <AppIcon name="plus" :size="13" />
            </button>
          </span>
        </div>
        <p v-if="rows.length === 0" class="empty">没有符合条件的课程。</p>
        <div v-else-if="rows.length > visibleRows.length" class="more-row">
          <button class="btn btn-sm" type="button" @click="visibleLimit += 120">
            显示更多（还有 {{ rows.length - visibleRows.length }} 门）
          </button>
        </div>
      </div>
    </div>

    <transition name="fade">
      <div v-if="compareCourses.length > 0" class="compare-bar">
        <div class="compare-head">
          <strong>课程对比 · {{ compareCourses.length }} 门</strong>
          <button type="button" class="icon-btn" @click="compareCodes = []"><AppIcon name="close" :size="14" /></button>
        </div>
        <div class="compare-table">
          <div class="compare-row" :style="compareGridStyle">
            <span class="row-label" />
            <span v-for="item in comparedFields" :key="item.course.code" class="col-head">
              <b>{{ item.course.name }}</b>
              <small class="mono">{{ item.course.code }}</small>
            </span>
          </div>
          <div v-for="index in 8" :key="index" class="compare-row" :style="compareGridStyle">
            <span class="row-label">{{ comparedFields[0]?.fields[index - 1]?.label }}</span>
            <span v-for="item in comparedFields" :key="item.course.code + index" class="cell">
              {{ item.fields[index - 1]?.value }}
            </span>
          </div>
        </div>
      </div>
    </transition>
  </div>
</template>

<style scoped>
.courses {
  max-width: 1320px;
  margin: 0 auto;
  padding-bottom: 120px;
}
.head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 14px;
}
.sub {
  margin-top: 4px;
  font-size: 12.5px;
  color: var(--muted);
}
.legend {
  display: flex;
  gap: 6px;
}

.filters {
  display: flex;
  gap: 8px;
  padding: 12px;
  margin-bottom: 12px;
  align-items: center;
  flex-wrap: wrap;
}
.search {
  flex: 1;
  min-width: 220px;
}
.filters .select {
  width: 130px;
  flex: none;
}
.toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 34px;
  padding: 0 12px;
  border: 1px solid var(--line-strong);
  border-radius: 9px;
  background: var(--surface);
  font-size: 12px;
  color: var(--muted);
  cursor: pointer;
  white-space: nowrap;
}
.toggle.on {
  background: var(--accent-soft);
  border-color: var(--accent-line);
  color: var(--accent-ink);
  font-weight: 600;
}

.table {
  overflow: hidden;
}
.thead,
.trow {
  display: grid;
  grid-template-columns: minmax(240px, 2.2fr) 56px minmax(90px, 0.8fr) minmax(180px, 1.4fr) 90px 104px;
  align-items: center;
  gap: 10px;
  padding: 0 14px;
}
.thead {
  height: 34px;
  background: var(--surface-2);
  border-bottom: 1px solid var(--line);
  font-size: 11px;
  color: var(--muted);
  font-weight: 600;
}
.trow {
  min-height: 54px;
  border-bottom: 1px solid var(--line);
  font-size: 12.5px;
}
.trow:last-child {
  border-bottom: 0;
}
.trow:hover {
  background: var(--surface-2);
}
.col-name {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex: none;
}
.name-wrap {
  display: flex;
  flex-direction: column;
  min-width: 0;
  line-height: 1.35;
}
.name {
  font-weight: 550;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.meta {
  font-size: 10.5px;
  color: var(--faint);
}
.col-credits {
  font-weight: 600;
}
.col-teacher,
.col-time {
  color: var(--ink-2);
  font-size: 11.5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.col-actions {
  display: flex;
  gap: 4px;
  justify-content: flex-end;
}
.empty {
  padding: 24px;
  text-align: center;
  color: var(--faint);
  font-size: 12.5px;
}
.more-row {
  display: flex;
  justify-content: center;
  padding: 14px;
}

.compare-bar {
  position: fixed;
  left: 50%;
  bottom: 16px;
  transform: translateX(-50%);
  width: min(1100px, calc(100vw - 48px));
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  z-index: 50;
  overflow: hidden;
}
.compare-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid var(--line);
  font-size: 13px;
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
.compare-table {
  max-height: 40vh;
  overflow: auto;
}
.compare-row {
  display: grid;
  grid-template-columns: 80px repeat(4, minmax(0, 1fr));
  gap: 0;
  border-bottom: 1px solid var(--line);
}
.compare-row:last-child {
  border-bottom: 0;
}
.row-label {
  padding: 8px 12px;
  font-size: 10.5px;
  color: var(--muted);
  background: var(--surface-2);
  border-right: 1px solid var(--line);
}
.col-head {
  padding: 8px 12px;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--line);
  font-size: 12px;
}
.col-head b {
  font-weight: 600;
}
.col-head small {
  color: var(--faint);
  font-size: 10px;
}
.cell {
  padding: 8px 12px;
  font-size: 11.5px;
  color: var(--ink-2);
  border-right: 1px solid var(--line);
  line-height: 1.5;
}
.cell:last-child {
  border-right: 0;
}
</style>
