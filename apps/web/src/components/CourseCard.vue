<script setup lang="ts">
import { computed } from 'vue';
import type { Course, Section } from '@planner/shared';
import { categoryColor, shortMeetingText, teachersText } from '@/utils/format';
import AppIcon from './AppIcon.vue';

const props = withDefaults(
  defineProps<{
    course: Course;
    sections: Section[];
    gap?: boolean;
    state?: 'available' | 'in-plan' | 'passed' | 'in-current-timetable' | 'conflict';
    compareSelected?: boolean;
    dense?: boolean;
  }>(),
  { gap: false, state: 'available', compareSelected: false, dense: false },
);

const emit = defineEmits<{
  (e: 'add', courseCode: string): void;
  (e: 'compare', courseCode: string): void;
  (e: 'detail', courseCode: string): void;
}>();

const firstTeacher = computed(() => (props.sections[0] ? teachersText(props.sections[0]) : '教师待定'));
const timeText = computed(() => (props.sections[0] ? shortMeetingText(props.sections[0]) : '—'));
const sectionCount = computed(() => props.sections.length);

const badge = computed(() => {
  if (props.state === 'in-plan') return { tone: 'chip-accent', text: '已在方案' };
  if (props.state === 'passed') return { tone: 'chip', text: '已修' };
  if (props.state === 'in-current-timetable') return { tone: 'chip-warn', text: '正在修' };
  if (props.state === 'conflict') return { tone: 'chip-danger', text: '与方案冲突' };
  return null;
});

function onDragStart(event: DragEvent) {
  if (!event.dataTransfer) return;
  event.dataTransfer.setData('text/plain', props.course.code);
  event.dataTransfer.effectAllowed = 'copy';
}
</script>

<template>
  <div
    class="course-card"
    :class="{ dense, muted: state === 'passed' }"
    :draggable="state !== 'in-plan'"
    @dragstart="onDragStart"
  >
    <div class="top">
      <span class="dot" :style="{ background: categoryColor(course.category) }" />
      <button type="button" class="name" @click="emit('detail', course.code)">{{ course.name }}</button>
      <span class="credits num">{{ course.credits }} 学分</span>
    </div>

    <div class="meta">
      <span class="mono">{{ course.code }}</span>
      <span class="sep">·</span>
      <span>{{ firstTeacher }}</span>
      <template v-if="sectionCount > 1">
        <span class="sep">·</span>
        <span>{{ sectionCount }} 个教学班</span>
      </template>
    </div>

    <div v-if="!dense" class="meta">
      <AppIcon name="clock" :size="12" />
      <span>{{ timeText }}</span>
    </div>

    <div class="bottom">
      <div class="badges">
        <span v-if="badge" class="chip" :class="badge.tone">{{ badge.text }}</span>
        <span v-if="gap && state !== 'in-plan'" class="chip chip-ok">可补缺口</span>
        <span v-if="course.assessment" class="chip">{{ course.assessment }}</span>
      </div>
      <div class="actions">
        <button
          type="button"
          class="mini"
          :class="{ active: compareSelected }"
          title="加入对比"
          @click.stop="emit('compare', course.code)"
        >
          <AppIcon name="compare" :size="13" />
        </button>
        <button
          v-if="state !== 'in-plan' && state !== 'passed'"
          type="button"
          class="mini add"
          title="加入方案"
          @click.stop="emit('add', course.code)"
        >
          <AppIcon name="plus" :size="14" />
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.course-card {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 9px 11px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  cursor: grab;
  transition: border-color 0.15s ease, box-shadow 0.15s ease, background 0.15s ease;
}
.course-card:hover {
  border-color: var(--line-strong);
  box-shadow: var(--shadow-sm);
  background: var(--surface-2);
}
.course-card:active {
  cursor: grabbing;
}
.course-card.dense {
  padding: 7px 10px;
  gap: 3px;
}
.course-card.muted {
  opacity: 0.62;
}
.top {
  display: flex;
  align-items: center;
  gap: 6px;
}
.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex: none;
}
.name {
  flex: 1;
  min-width: 0;
  border: 0;
  background: none;
  padding: 0;
  text-align: left;
  font-size: 13px;
  font-weight: 600;
  color: var(--ink);
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.name:hover {
  color: var(--accent-ink);
  text-decoration: underline;
  text-underline-offset: 2px;
}
.credits {
  font-size: 11px;
  color: var(--muted);
  flex: none;
}
.meta {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--muted);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.sep {
  opacity: 0.5;
}
.mono {
  font-family: var(--mono);
  font-size: 10.5px;
}
.bottom {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  margin-top: 2px;
}
.badges {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
  min-width: 0;
}
.chip {
  height: 18px;
  padding: 0 6px;
  font-size: 10px;
}
.actions {
  display: flex;
  gap: 3px;
  flex: none;
}
.mini {
  width: 24px;
  height: 24px;
  display: grid;
  place-items: center;
  border: 1px solid var(--line);
  background: var(--surface);
  border-radius: 7px;
  color: var(--muted);
  cursor: pointer;
  transition: all 0.15s ease;
}
.mini:hover {
  border-color: var(--line-strong);
  color: var(--ink);
  background: var(--surface-3);
}
.mini.active {
  background: var(--accent-soft);
  border-color: var(--accent-line);
  color: var(--accent-ink);
}
.mini.add:hover {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}
</style>
