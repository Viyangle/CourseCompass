<script setup lang="ts">
import { dismissToast, useToasts } from '@/composables/toast';
import AppIcon from './AppIcon.vue';

const state = useToasts();
</script>

<template>
  <div class="toasts" aria-live="polite">
    <transition-group name="toast">
      <div v-for="item in state.items" :key="item.id" class="toast" :class="item.tone">
        <AppIcon :name="item.tone === 'ok' ? 'check' : item.tone === 'error' ? 'alert' : 'info'" :size="15" />
        <span class="text">{{ item.text }}</span>
        <button v-if="item.action" type="button" class="act" @click="item.action.run(); dismissToast(item.id)">
          {{ item.action.label }}
        </button>
        <button type="button" class="close" aria-label="关闭" @click="dismissToast(item.id)">
          <AppIcon name="close" :size="12" />
        </button>
      </div>
    </transition-group>
  </div>
</template>

<style scoped>
.toasts {
  position: fixed;
  left: 50%;
  bottom: 26px;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  gap: 8px;
  z-index: 100;
  pointer-events: none;
}
.toast {
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 220px;
  max-width: 520px;
  padding: 9px 12px;
  border-radius: 10px;
  background: var(--ink);
  color: #fff;
  font-size: 12.5px;
  box-shadow: var(--shadow-lg);
}
.toast.ok {
  background: #136b4f;
}
.toast.error {
  background: #9b251c;
}
.text {
  flex: 1;
}
.act {
  border: 0;
  background: rgba(255, 255, 255, 0.16);
  color: #fff;
  border-radius: 6px;
  padding: 3px 8px;
  font-size: 11.5px;
  cursor: pointer;
}
.act:hover {
  background: rgba(255, 255, 255, 0.26);
}
.close {
  border: 0;
  background: transparent;
  color: rgba(255, 255, 255, 0.7);
  cursor: pointer;
  display: grid;
  place-items: center;
  padding: 2px;
}
.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(8px);
}
</style>
