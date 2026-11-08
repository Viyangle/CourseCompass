import type {
  ApiResult,
  AuthMethod,
  BootstrapData,
  Course,
  CourseQueryResult,
  Plan,
  PlanAnalysis,
  PlanComparison,
  Section,
  SessionInfo,
  SourceRecord,
  Term,
} from '@planner/shared';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly details?: unknown,
    readonly status = 0,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      credentials: 'same-origin',
      ...init,
      headers: {
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init.headers ?? {}),
      },
    });
  } catch {
    throw new ApiError('无法连接后端服务，请确认 server 已启动', 'NETWORK', undefined, 0);
  }

  const payload = (await response.json().catch(() => null)) as ApiResult<T> | null;
  if (!payload) {
    throw new ApiError(`服务返回了非 JSON 内容（HTTP ${response.status}）`, 'BAD_RESPONSE', undefined, response.status);
  }
  if (!payload.ok) {
    throw new ApiError(payload.error.message, payload.error.code, payload.error.details, response.status);
  }
  return payload.data;
}

export interface CatalogPayload {
  termId: string;
  courses: Course[];
  sections: Section[];
  currentTermSections: Section[];
}

export const api = {
  session: () => request<SessionInfo>('/api/session'),

  login: (body: { method: AuthMethod; username?: string; password?: string; cookie?: string }) =>
    request<SessionInfo>('/api/auth/login', { method: 'POST', body: JSON.stringify(body) }),

  logout: () => request<{ loggedOut: boolean }>('/api/auth/logout', { method: 'POST' }),

  bootstrap: () => request<BootstrapData>('/api/bootstrap'),

  catalog: (termId?: string) =>
    request<CatalogPayload>(`/api/catalog${termId ? `?termId=${encodeURIComponent(termId)}` : ''}`),

  courses: (query: Record<string, string | number | boolean | undefined>) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === '' || value === false) continue;
      params.set(key, String(value === true ? 1 : value));
    }
    return request<CourseQueryResult>(`/api/courses?${params.toString()}`);
  },

  program: (planId?: string) =>
    request<{ program: BootstrapData['program']; progress: unknown; policy: string }>(
      `/api/program${planId ? `?planId=${planId}` : ''}`,
    ),

  plans: () => request<{ plans: { plan: Plan; analysis: PlanAnalysis }[] }>('/api/plans'),

  createPlan: (body: { name: string; copyFrom?: string }) =>
    request<{ plan: Plan; analysis: PlanAnalysis }>('/api/plans', { method: 'POST', body: JSON.stringify(body) }),

  updatePlan: (id: string, body: { name?: string; note?: string; color?: string }) =>
    request<{ plan: Plan }>(`/api/plans/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

  deletePlan: (id: string) => request<{ deleted: string }>(`/api/plans/${id}`, { method: 'DELETE' }),

  duplicatePlan: (id: string) =>
    request<{ plan: Plan; analysis: PlanAnalysis }>(`/api/plans/${id}/duplicate`, { method: 'POST' }),

  saveItems: (id: string, items: { sectionId: string; status: 'selected' | 'backup'; note?: string }[]) =>
    request<{ plan: Plan; analysis: PlanAnalysis }>(`/api/plans/${id}/items`, {
      method: 'PUT',
      body: JSON.stringify({ items }),
    }),

  compare: (ids: string[]) =>
    request<PlanComparison>(`/api/compare?ids=${ids.map(encodeURIComponent).join(',')}`),

  sync: (sources?: string[]) =>
    request<{ synced: string[]; mode?: string; message?: string }>('/api/sync', {
      method: 'POST',
      body: JSON.stringify({ sources }),
    }),

  sources: () => request<{ sources: SourceRecord[]; snapshots: unknown[] }>('/api/sources'),

  exportUrl: (planId: string, format: 'md' | 'csv' | 'ics') =>
    `/api/export/${encodeURIComponent(planId)}?format=${format}`,

  probe: (body: { appId: string; module: string; method: string }) =>
    request<{
      ok: boolean;
      status: number;
      needsLogin: boolean;
      rowCount: number;
      sampleKeys: string[];
      error?: string;
      url: string;
    }>('/api/dev/probe', { method: 'POST', body: JSON.stringify(body) }),
};

export type { Term };
