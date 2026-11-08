<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useDataStore } from '@/stores/data';
import { useSessionStore } from '@/stores/session';
import { formatRelativeTime } from '@planner/shared';
import AppIcon from './AppIcon.vue';

const route = useRoute();
const router = useRouter();
const data = useDataStore();
const session = useSessionStore();

const syncing = ref(false);
const menuOpen = ref(false);

const nav = [
  { to: '/', label: '概览', icon: 'overview' as const },
  { to: '/program', label: '培养方案', icon: 'program' as const },
  { to: '/planner', label: '选课规划', icon: 'calendar' as const },
  { to: '/courses', label: '课程库', icon: 'search' as const },
  { to: '/compare', label: '方案对比', icon: 'compare' as const },
  { to: '/settings', label: '设置', icon: 'settings' as const },
];

const freshness = computed(() => {
  const times = data.sources.map((source) => source.fetchedAt).filter(Boolean) as string[];
  if (times.length === 0) return '尚未同步';
  const latest = times.sort().at(-1);
  return `数据更新于 ${formatRelativeTime(latest)}`;
});

/** 数据模式看「来源」，而不是看登录方式：用本地会话进入也可能读的是真实数据。 */
const dataMode = computed<'demo' | 'real'>(() => {
  if (data.sources.length === 0) return 'demo';
  return data.sources.every((source) => source.mode === 'mock') ? 'demo' : 'real';
});

const stale = computed(() => {
  const latest = data.sources.map((source) => source.fetchedAt).filter(Boolean).sort().at(-1);
  if (!latest) return true;
  return Date.now() - new Date(latest).getTime() > 24 * 3600 * 1000;
});

async function sync() {
  if (syncing.value) return;
  syncing.value = true;
  try {
    await data.sync();
  } finally {
    syncing.value = false;
  }
}

async function logout() {
  await session.logout();
  router.push('/login');
}
</script>

<template>
  <div class="shell">
    <aside class="sidebar">
      <div class="brand">
        <div class="mark">选</div>
        <div class="brand-text">
          <strong>选课工作台</strong>
          <span>学业规划 · NJU</span>
        </div>
      </div>

      <nav class="nav">
        <router-link v-for="item in nav" :key="item.to" :to="item.to" class="nav-item" active-class="is-active">
          <AppIcon :name="item.icon" :size="17" />
          <span>{{ item.label }}</span>
        </router-link>
      </nav>

      <div class="sidebar-foot">
        <div v-if="dataMode === 'demo'" class="demo-note">
          <AppIcon name="info" :size="14" />
          <span>演示数据</span>
        </div>
        <div v-else class="demo-note real">
          <AppIcon name="check" :size="14" />
          <span>真实数据 · ehall</span>
        </div>
        <button class="profile" type="button" @click="menuOpen = !menuOpen">
          <span class="avatar">{{ data.profile?.name?.slice(0, 1) ?? '同' }}</span>
          <span class="profile-text">
            <strong>{{ data.profile?.name ?? '同学' }}</strong>
            <span>{{ data.profile?.major ?? '—' }} · {{ data.profile?.gradeYear ?? '—' }} 级</span>
          </span>
        </button>
        <transition name="fade">
          <div v-if="menuOpen" class="profile-menu">
            <button type="button" @click="logout">
              <AppIcon name="logout" :size="15" /> 退出登录
            </button>
          </div>
        </transition>
      </div>
    </aside>

    <div class="main">
      <header class="topbar">
        <div class="crumb">
          <span>{{ route.meta.title ?? '概览' }}</span>
        </div>
        <div class="topbar-right">
          <span class="freshness" :class="{ stale }">
            <span class="dot" />
            {{ freshness }}
          </span>
          <button class="btn btn-sm" type="button" :disabled="syncing" @click="sync">
            <AppIcon name="refresh" :size="14" :class="{ spin: syncing }" />
            同步
          </button>
          <router-link to="/planner" class="btn btn-sm btn-primary">
            <AppIcon name="calendar" :size="14" />
            去规划
          </router-link>
        </div>
      </header>

      <main class="content">
        <slot />
      </main>
    </div>
  </div>
</template>

<style scoped>
.shell {
  display: flex;
  height: 100vh;
  overflow: hidden;
}

.sidebar {
  width: var(--sidebar);
  flex: none;
  background: var(--surface);
  border-right: 1px solid var(--line);
  display: flex;
  flex-direction: column;
  padding: 18px 12px 14px;
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 8px 20px;
}
.mark {
  width: 32px;
  height: 32px;
  border-radius: 9px;
  background: linear-gradient(145deg, #7c3aed, #4c1d95);
  color: #fff;
  display: grid;
  place-items: center;
  font-weight: 700;
  font-size: 15px;
  box-shadow: 0 6px 14px -8px rgba(76, 29, 149, 0.9);
}
.brand-text {
  display: flex;
  flex-direction: column;
  line-height: 1.25;
}
.brand-text strong {
  font-size: 13.5px;
  letter-spacing: -0.01em;
}
.brand-text span {
  font-size: 10.5px;
  color: var(--faint);
  letter-spacing: 0.02em;
}

.nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 36px;
  padding: 0 10px;
  border-radius: 9px;
  color: var(--ink-2);
  font-size: 13.2px;
  font-weight: 520;
  transition: background 0.15s ease, color 0.15s ease;
}
.nav-item:hover {
  background: var(--surface-3);
}
.nav-item.is-active {
  background: var(--accent-soft);
  color: var(--accent-ink);
  font-weight: 600;
}

.sidebar-foot {
  margin-top: auto;
  padding-top: 16px;
  position: relative;
}
.demo-note {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--warn);
  background: var(--warn-soft);
  border-radius: 7px;
  padding: 5px 8px;
  margin-bottom: 8px;
}
.demo-note.real {
  color: var(--ok);
  background: var(--ok-soft);
}
.profile {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 8px;
  border: 0;
  background: transparent;
  border-radius: 10px;
  cursor: pointer;
  text-align: left;
}
.profile:hover {
  background: var(--surface-3);
}
.avatar {
  width: 30px;
  height: 30px;
  flex: none;
  border-radius: 50%;
  background: var(--surface-3);
  color: var(--ink-2);
  display: grid;
  place-items: center;
  font-size: 12px;
  font-weight: 600;
}
.profile-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
  line-height: 1.3;
}
.profile-text strong {
  font-size: 12.5px;
}
.profile-text span {
  font-size: 10.5px;
  color: var(--faint);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.profile-menu {
  position: absolute;
  bottom: 52px;
  left: 4px;
  right: 4px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 10px;
  box-shadow: var(--shadow-md);
  padding: 4px;
  z-index: 20;
}
.profile-menu button {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: 32px;
  padding: 0 8px;
  border: 0;
  background: transparent;
  border-radius: 7px;
  font-size: 12.5px;
  cursor: pointer;
}
.profile-menu button:hover {
  background: var(--surface-3);
}

.main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.topbar {
  height: var(--topbar);
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 24px;
  border-bottom: 1px solid var(--line);
  background: rgba(245, 244, 240, 0.86);
  backdrop-filter: blur(8px);
}
.crumb {
  font-size: 13px;
  font-weight: 600;
  color: var(--ink-2);
}
.topbar-right {
  display: flex;
  align-items: center;
  gap: 12px;
}
.freshness {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11.5px;
  color: var(--muted);
}
.freshness .dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--ok);
}
.freshness.stale .dot {
  background: var(--warn);
}
.spin {
  animation: spin 0.9s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.content {
  flex: 1;
  overflow: auto;
  padding: 26px 28px 48px;
}

@media (max-width: 1080px) {
  .sidebar {
    width: 68px;
    padding: 16px 8px;
  }
  .brand-text,
  .nav-item span,
  .profile-text,
  .demo-note span {
    display: none;
  }
  .nav-item {
    justify-content: center;
  }
  .profile {
    justify-content: center;
  }
  .freshness {
    display: none;
  }
}
</style>
