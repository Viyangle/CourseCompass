<script setup lang="ts">
import { computed, watch } from 'vue';
import { useRoute } from 'vue-router';
import AppShell from '@/components/AppShell.vue';
import ToastStack from '@/components/ToastStack.vue';
import { useSessionStore } from '@/stores/session';
import { useDataStore } from '@/stores/data';
import { usePlannerStore } from '@/stores/planner';
import AppIcon from '@/components/AppIcon.vue';

const route = useRoute();
const session = useSessionStore();
const data = useDataStore();
const planner = usePlannerStore();

const bare = computed(() => route.meta.public === true || !session.authenticated);

watch(
  () => [session.authenticated, session.ready] as const,
  async ([authenticated, ready]) => {
    if (!ready || !authenticated) return;
    if (!data.loaded && !data.loading) {
      await data.load();
      planner.hydrate(data.plans);
    }
  },
  { immediate: true },
);
</script>

<template>
  <template v-if="bare">
    <router-view />
  </template>

  <template v-else-if="data.error">
    <div class="fatal">
      <AppIcon name="alert" :size="28" />
      <h2>数据没能加载出来</h2>
      <p class="muted">{{ data.error }}</p>
      <button class="btn btn-primary" type="button" @click="data.load()">重试</button>
    </div>
  </template>

  <template v-else-if="!data.loaded">
    <div class="fatal">
      <div class="spinner" />
      <p class="muted">正在整理你的培养方案、课表与方案…</p>
    </div>
  </template>

  <AppShell v-else>
    <router-view v-slot="{ Component }">
      <transition name="fade" mode="out-in">
        <component :is="Component" />
      </transition>
    </router-view>
  </AppShell>

  <ToastStack />
</template>

<style scoped>
.fatal {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--ink-2);
}
.spinner {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  border: 2px solid var(--line);
  border-top-color: var(--accent);
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
