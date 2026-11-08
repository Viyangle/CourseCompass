import { createRouter, createWebHistory } from 'vue-router';
import { useSessionStore } from '@/stores/session';

const OverviewView = () => import('@/views/OverviewView.vue');
const ProgramView = () => import('@/views/ProgramView.vue');
const PlannerView = () => import('@/views/PlannerView.vue');
const CoursesView = () => import('@/views/CoursesView.vue');
const CompareView = () => import('@/views/CompareView.vue');
const SettingsView = () => import('@/views/SettingsView.vue');
const LoginView = () => import('@/views/LoginView.vue');

export const router = createRouter({
  history: createWebHistory(),
  scrollBehavior: () => ({ top: 0 }),
  routes: [
    { path: '/login', name: 'login', component: LoginView, meta: { public: true, title: '登录' } },
    { path: '/', name: 'overview', component: OverviewView, meta: { title: '概览' } },
    { path: '/program', name: 'program', component: ProgramView, meta: { title: '培养方案' } },
    { path: '/planner', name: 'planner', component: PlannerView, meta: { title: '选课规划' } },
    { path: '/courses', name: 'courses', component: CoursesView, meta: { title: '课程库' } },
    { path: '/compare', name: 'compare', component: CompareView, meta: { title: '方案对比' } },
    { path: '/settings', name: 'settings', component: SettingsView, meta: { title: '设置' } },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
});

router.beforeEach(async (to) => {
  const session = useSessionStore();
  if (!session.ready) await session.refresh();

  if (to.meta.public) {
    if (session.authenticated && to.name === 'login') return { name: 'overview' };
    return true;
  }
  if (!session.authenticated) {
    return { name: 'login', query: { redirect: to.fullPath } };
  }
  return true;
});
