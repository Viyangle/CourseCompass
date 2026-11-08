<script setup lang="ts">
withDefaults(
  defineProps<{
    label: string;
    value: string;
    hint?: string;
    tone?: 'default' | 'accent' | 'ok' | 'warn' | 'danger';
    progress?: number;
  }>(),
  { tone: 'default', progress: undefined, hint: '' },
);
</script>

<template>
  <div class="stat" :class="tone">
    <div class="label">{{ label }}</div>
    <div class="value num">{{ value }}</div>
    <div v-if="hint" class="hint">{{ hint }}</div>
    <div v-if="progress !== undefined" class="track">
      <div class="fill" :style="{ width: `${Math.min(100, Math.max(0, progress))}%` }" />
    </div>
  </div>
</template>

<style scoped>
.stat {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}
.label {
  font-size: 11.5px;
  color: var(--muted);
  font-weight: 500;
}
.value {
  font-size: 24px;
  font-weight: 640;
  letter-spacing: -0.02em;
  line-height: 1.25;
}
.hint {
  font-size: 11px;
  color: var(--faint);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.track {
  margin-top: 7px;
  height: 4px;
  border-radius: 99px;
  background: var(--surface-3);
  overflow: hidden;
}
.fill {
  height: 100%;
  background: var(--ink-2);
  transition: width 0.4s ease;
}
.accent .value {
  color: var(--accent-ink);
}
.accent .fill {
  background: var(--accent);
}
.ok .value {
  color: var(--ok);
}
.ok .fill {
  background: var(--ok);
}
.warn .value {
  color: var(--warn);
}
.warn .fill {
  background: var(--warn);
}
.danger .value {
  color: var(--danger);
}
.danger .fill {
  background: var(--danger);
}
</style>
