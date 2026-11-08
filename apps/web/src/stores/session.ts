import { defineStore } from 'pinia';
import type { SessionInfo } from '@planner/shared';
import { api, ApiError } from '@/api/client';

export const useSessionStore = defineStore('session', {
  state: () => ({
    info: null as SessionInfo | null,
    ready: false,
    busy: false,
    error: '' as string,
    errorHint: '' as string,
  }),

  getters: {
    authenticated: (state) => Boolean(state.info?.authenticated),
    offline: (state) => Boolean(state.info?.offline),
    displayName: (state) => state.info?.profile?.name ?? '同学',
  },

  actions: {
    async refresh() {
      try {
        this.info = await api.session();
      } catch {
        this.info = null;
      } finally {
        this.ready = true;
      }
    },

    async loginDemo() {
      this.busy = true;
      this.error = '';
      try {
        this.info = await api.login({ method: 'demo' });
      } catch (error) {
        this.error = error instanceof Error ? error.message : '登录失败';
      } finally {
        this.busy = false;
      }
      return this.authenticated;
    },

    async loginCas(username: string, password: string) {
      this.busy = true;
      this.error = '';
      this.errorHint = '';
      try {
        this.info = await api.login({ method: 'cas', username, password });
        return true;
      } catch (error) {
        if (error instanceof ApiError) {
          this.error = error.message;
          const details = error.details as { hint?: string } | undefined;
          this.errorHint = details?.hint ?? '';
        } else {
          this.error = '登录失败';
        }
        return false;
      } finally {
        this.busy = false;
      }
    },

    async loginCookie(cookie: string) {
      this.busy = true;
      this.error = '';
      try {
        this.info = await api.login({ method: 'cookie', cookie });
        return true;
      } catch (error) {
        this.error = error instanceof Error ? error.message : '导入失败';
        return false;
      } finally {
        this.busy = false;
      }
    },

    async logout() {
      try {
        await api.logout();
      } finally {
        this.info = null;
      }
    },
  },
});
