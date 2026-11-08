<script setup lang="ts">
import { computed } from 'vue';
import {
  DEFAULT_PERIODS,
  formatDay,
  formatWeeks,
  maskToWeeks,
  patternToMask,
  type ConflictIssue,
  type Course,
  type PeriodConfig,
  type PlanItem,
  type Section,
} from '@planner/shared';
import { categoryColor } from '@/utils/format';

const props = withDefaults(
  defineProps<{
    items: PlanItem[];
    sections: Section[];
    courses: Course[];
    periods?: PeriodConfig[];
    /** 0 = 全部周（并集） */
    week?: number;
    conflicts?: ConflictIssue[];
    compact?: boolean;
    interactive?: boolean;
    /** 是否显示周六、周日。默认隐藏：7 列挤在侧栏之间时，课程名会拆成一列一个字。 */
    showWeekend?: boolean;
  }>(),
  {
    periods: () => DEFAULT_PERIODS,
    week: 0,
    conflicts: () => [],
    compact: false,
    interactive: true,
    showWeekend: false,
  },
);

const emit = defineEmits<{
  (e: 'select', itemId: string): void;
  (e: 'remove', itemId: string): void;
  (e: 'drop-course', courseCode: string): void;
}>();

const rows = computed(() => (props.periods.length > 0 ? props.periods : DEFAULT_PERIODS));
const rowHeight = computed(() => (props.compact ? 36 : 54));
const days = computed(() => (props.showWeekend ? [1, 2, 3, 4, 5, 6, 7] : [1, 2, 3, 4, 5]));

interface Block {
  key: string;
  itemId: string;
  courseCode: string;
  courseName: string;
  teachers: string;
  location: string;
  day: number;
  start: number;
  end: number;
  weeksLabel: string;
  color: string;
  hasConflict: boolean;
}

const blocks = computed<Block[]>(() => {
  const sectionById = new Map(props.sections.map((section) => [section.id, section]));
  const courseByCode = new Map(props.courses.map((course) => [course.code, course]));

  // 冲突要落到"具体时段"上：同一门课可能只有周一那节和别的课撞，周三那节并没有。
  // 如果按课程整体标红，用户会误以为整门课都冲突。
  const conflictSpans = new Map<string, { day: number; start: number; end: number }[]>();
  for (const issue of props.conflicts) {
    if (issue.severity !== 'error' || !issue.time) continue;
    for (const itemId of issue.itemIds) {
      const list = conflictSpans.get(itemId) ?? [];
      list.push({ day: issue.time.day, start: issue.time.startPeriod, end: issue.time.endPeriod });
      conflictSpans.set(itemId, list);
    }
  }

  const out: Block[] = [];
  for (const item of props.items) {
    if (item.status !== 'selected') continue;
    const section = sectionById.get(item.sectionId);
    if (!section) continue;
    const course = courseByCode.get(section.courseCode);
    for (const meeting of section.meetings) {
      const mask = patternToMask(meeting.weeks);
      if (props.week > 0 && (mask & (1 << (props.week - 1))) === 0) continue;
      const spans = conflictSpans.get(item.id) ?? [];
      const hasConflict = spans.some(
        (span) =>
          span.day === meeting.day &&
          Math.max(span.start, meeting.startPeriod) <= Math.min(span.end, meeting.endPeriod),
      );
      out.push({
        key: `${item.id}-${meeting.day}-${meeting.startPeriod}-${meeting.endPeriod}`,
        itemId: item.id,
        courseCode: section.courseCode,
        courseName: course?.name ?? section.courseCode,
        teachers: section.teachers.join('、'),
        location: meeting.location ?? section.campus ?? '',
        day: meeting.day,
        start: meeting.startPeriod,
        end: meeting.endPeriod,
        weeksLabel: formatWeeks(props.week > 0 ? [props.week] : maskToWeeks(mask)),
        color: categoryColor(course?.category),
        hasConflict,
      });
    }
  }
  return out;
});

function dayBlocks(day: number): (Block & { lane: number; lanes: number })[] {
  const list = blocks.value
    .filter((block) => block.day === day)
    .sort((a, b) => a.start - b.start || a.end - b.end);

  // 同一天的课程按"时间段重叠"分簇；簇内再分泳道，冲突的两门课就能并排看见，
  // 而不是后渲染的那门把前一门完全盖住。
  const clusters: Block[][] = [];
  let current: Block[] = [];
  let clusterEnd = -1;
  for (const block of list) {
    if (current.length > 0 && block.start > clusterEnd) {
      clusters.push(current);
      current = [];
      clusterEnd = -1;
    }
    current.push(block);
    clusterEnd = Math.max(clusterEnd, block.end);
  }
  if (current.length > 0) clusters.push(current);

  const laneMap = new Map<string, { lane: number; lanes: number }>();
  for (const cluster of clusters) {
    const laneEnds: number[] = [];
    const laneOf = new Map<string, number>();
    for (const block of cluster) {
      let lane = laneEnds.findIndex((end) => end < block.start);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(block.end);
      } else {
        laneEnds[lane] = block.end;
      }
      laneOf.set(block.key, lane);
    }
    for (const block of cluster) {
      laneMap.set(block.key, { lane: laneOf.get(block.key) ?? 0, lanes: laneEnds.length });
    }
  }

  return list.map((block) => ({ ...block, ...(laneMap.get(block.key) ?? { lane: 0, lanes: 1 }) }));
}

function blockStyle(block: Block & { lane?: number; lanes?: number }): Record<string, string> {
  const height = (block.end - block.start + 1) * rowHeight.value - 6;
  const lanes = block.lanes && block.lanes > 1 ? block.lanes : 1;
  const lane = block.lane ?? 0;
  return {
    top: `${(block.start - 1) * rowHeight.value + 3}px`,
    height: `${Math.max(height, rowHeight.value - 6)}px`,
    left: lanes > 1 ? `calc(${(lane / lanes) * 100}% + 2px)` : '3px',
    right: 'auto',
    width: lanes > 1 ? `calc(${100 / lanes}% - 4px)` : 'auto',
    '--c': block.color,
  };
}

function onDrop(event: DragEvent): void {
  const code = event.dataTransfer?.getData('text/plain');
  if (code) emit('drop-course', code);
}

const isEmpty = computed(() => blocks.value.length === 0);
</script>

<template>
  <div
    class="timetable"
    :class="{ compact }"
    :style="{ '--row': `${rowHeight}px` }"
    @dragover.prevent
    @drop="onDrop"
  >
    <div class="head">
      <div class="head-time">节次</div>
      <div v-for="day in days" :key="day" class="head-day" :class="{ weekend: day > 5 }">
        {{ compact ? formatDay(day).replace('周', '') : formatDay(day) }}
      </div>
    </div>

    <div class="body">
      <div class="times">
        <div v-for="period in rows" :key="period.period" class="time-cell">
          <span class="period-num num">{{ period.period }}</span>
          <span v-if="!compact" class="period-time num">{{ period.start }}</span>
        </div>
      </div>

      <div class="cols">
        <div v-for="day in days" :key="day" class="col" :class="{ weekend: day > 5 }">
          <div v-for="period in rows" :key="period.period" class="slot" />
          <button
            v-for="block in dayBlocks(day)"
            :key="block.key"
            type="button"
            class="block"
            :class="{ conflict: block.hasConflict }"
            :style="blockStyle(block)"
            :title="`${block.courseName} · ${block.teachers} · ${block.location || '地点待定'} · ${block.weeksLabel}`"
            @click="interactive && emit('select', block.itemId)"
          >
            <span class="block-title">{{ block.courseName }}</span>
            <span v-if="!compact" class="block-meta">{{ block.location }}</span>
            <span v-if="!compact" class="block-meta weeks">{{ block.weeksLabel }}</span>
            <span v-if="block.hasConflict" class="conflict-dot" />
          </button>        </div>
      </div>

      <div v-if="isEmpty" class="empty-hint">
        <slot name="empty">还没有课程 —— 从左侧加入，或把课程卡片拖进来。</slot>
      </div>
    </div>
  </div>
</template>

<style scoped>
.timetable {
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
  overflow: hidden;
}

.head {
  display: flex;
  border-bottom: 1px solid var(--line);
  background: var(--surface-2);
}
.head-time,
.head-day {
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--muted);
}
.head-time {
  width: 54px;
  flex: none;
  font-weight: 500;
  font-size: 10.5px;
}
.head-day {
  flex: 1;
  border-left: 1px solid var(--line);
}
.head-day.weekend {
  background: color-mix(in srgb, var(--surface-3) 60%, white);
}

.body {
  position: relative;
  display: flex;
}

.times {
  width: 54px;
  flex: none;
  border-right: 1px solid var(--line);
  background: var(--surface-2);
}
.time-cell {
  height: var(--row);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1px;
  border-bottom: 1px dashed var(--line);
}
.time-cell:last-child {
  border-bottom: 0;
}
.period-num {
  font-size: 11px;
  font-weight: 600;
  color: var(--ink-2);
}
.period-time {
  font-size: 9px;
  color: var(--faint);
}
.compact .time-cell {
  justify-content: center;
}

.cols {
  display: flex;
  flex: 1;
  min-width: 0;
}
.col {
  flex: 1;
  min-width: 0;
  position: relative;
  border-left: 1px solid var(--line);
}
.col:first-child {
  border-left: 0;
}
.col.weekend {
  background: color-mix(in srgb, var(--surface-3) 35%, white);
}
.slot {
  height: var(--row);
  border-bottom: 1px dashed var(--line);
}
.slot:last-child {
  border-bottom: 0;
}

.block {
  position: absolute;
  left: 3px;
  right: 3px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 1px;
  padding: 4px 6px;
  border: 0;
  border-left: 3px solid var(--c);
  border-radius: 7px;
  background: color-mix(in srgb, var(--c) 11%, white);
  color: color-mix(in srgb, var(--c) 82%, black);
  text-align: left;
  cursor: pointer;
  overflow: hidden;
  transition: transform 0.12s ease, box-shadow 0.12s ease;
}
.block:hover {
  transform: translateY(-1px);
  box-shadow: var(--shadow-sm);
  z-index: 3;
}
.block-title {
  font-size: 11.5px;
  font-weight: 600;
  line-height: 1.3;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-word;
}
.block-meta {
  font-size: 9.5px;
  opacity: 0.75;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}
.block-meta.weeks {
  opacity: 0.6;
}
.compact .block {
  padding: 3px 5px;
}
.compact .block-title {
  font-size: 10.5px;
  -webkit-line-clamp: 1;
}

.block.conflict {
  background: repeating-linear-gradient(
    135deg,
    color-mix(in srgb, var(--danger) 14%, white) 0 6px,
    color-mix(in srgb, var(--danger) 6%, white) 6px 12px
  );
  border-left-color: var(--danger);
  color: var(--danger);
  outline: 1px solid color-mix(in srgb, var(--danger) 45%, white);
}
.conflict-dot {
  position: absolute;
  top: 5px;
  right: 5px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--danger);
}

.empty-hint {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: var(--faint);
  font-size: 12.5px;
  pointer-events: none;
}
</style>
