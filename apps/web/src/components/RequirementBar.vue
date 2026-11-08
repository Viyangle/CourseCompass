<script setup lang="ts">
import { computed } from 'vue';
import { formatCredits, progressPercent, type RequirementProgress } from '@planner/shared';

const props = withDefaults(
  defineProps<{
    node: RequirementProgress;
    compact?: boolean;
    showNumbers?: boolean;
    hideName?: boolean;
  }>(),
  { compact: false, showNumbers: true, hideName: false },
);

const percent = computed(() => progressPercent(props.node));
const earnedPercent = computed(() =>
  props.node.requiredCredits > 0
    ? Math.min(100, (props.node.earnedCredits / props.node.requiredCredits) * 100)
    : 100,
);
const shortfall = computed(() => Math.max(0, props.node.requiredCredits - props.node.earnedCredits - props.node.plannedCredits));

const tone = computed(() => {
  if (props.node.status === 'met') return 'met';
  if (props.node.status === 'planned') return 'planned';
  return 'short';
});
</script>

<template>
  <div class="req" :class="[tone, { compact }]">
    <div class="req-head">
      <span v-if="!hideName" class="req-name">{{ node.name }}</span>
      <span v-if="showNumbers" class="req-num num">
        <b>{{ formatCredits(node.earnedCredits) }}</b>
        <span class="sep">/</span>
        <span>{{ formatCredits(node.requiredCredits) }}</span>
        <span v-if="node.plannedCredits > 0" class="planned-num">+{{ formatCredits(node.plannedCredits) }}</span>
      </span>
    </div>
    <div class="track" :aria-label="`${node.name} 进度 ${percent}%`">
      <div class="fill earned" :style="{ width: `${earnedPercent}%` }" />
      <div class="fill planned" :style="{ width: `${Math.max(0, percent - earnedPercent)}%` }" />
    </div>
    <div v-if="!compact && showNumbers" class="req-foot">
      <span v-if="node.status === 'met'" class="foot met">已满足</span>
      <span v-else-if="node.status === 'planned'" class="foot planned">
        计划可覆盖 · 还差 {{ formatCredits(shortfall) }}
      </span>
      <span v-else class="foot short">还差 {{ formatCredits(shortfall) }} 学分</span>
      <span v-if="node.requiredCredits > 0" class="pct num">{{ percent }}%</span>
    </div>
  </div>
</template>

<style scoped>
.req {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.req-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
}
.req-name {
  font-size: 12.5px;
  color: var(--ink-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.req-num {
  font-size: 11.5px;
  color: var(--muted);
  flex: none;
}
.req-num b {
  color: var(--ink);
  font-weight: 600;
}
.sep {
  margin: 0 1px;
  opacity: 0.6;
}
.planned-num {
  color: var(--accent);
  margin-left: 3px;
}

.track {
  height: 6px;
  border-radius: 99px;
  background: var(--surface-3);
  overflow: hidden;
  display: flex;
}
.compact .track {
  height: 4px;
}
.fill {
  height: 100%;
  transition: width 0.35s cubic-bezier(0.2, 0.8, 0.2, 1);
}
.earned {
  background: var(--ink-2);
}
.planned {
  background: repeating-linear-gradient(
    135deg,
    var(--accent-line) 0 3px,
    color-mix(in srgb, var(--accent) 22%, white) 3px 6px
  );
}
.met .earned {
  background: var(--ok);
}
.short .fill.earned {
  background: var(--warn);
}

.req-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 10.5px;
}
.foot.met {
  color: var(--ok);
}
.foot.planned {
  color: var(--accent-ink);
}
.foot.short {
  color: var(--muted);
}
.pct {
  color: var(--faint);
}
</style>
