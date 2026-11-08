import type { ConflictIssue, RequirementProgress, Severity } from './types.js';

export function formatCredits(value: number): string {
  if (Number.isInteger(value)) return `${value}`;
  return value.toFixed(1);
}

export function formatSigned(value: number): string {
  return value > 0 ? `+${formatCredits(value)}` : formatCredits(value);
}

const SEVERITY_ORDER: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

export function sortIssues(issues: ConflictIssue[]): ConflictIssue[] {
  return [...issues].sort((a, b) => {
    const diff = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (diff !== 0) return diff;
    return a.kind.localeCompare(b.kind);
  });
}

export function countBySeverity(issues: ConflictIssue[]): Record<Severity, number> {
  return issues.reduce(
    (acc, issue) => {
      acc[issue.severity] += 1;
      return acc;
    },
    { error: 0, warning: 0, info: 0 } as Record<Severity, number>,
  );
}

export function progressPercent(node: RequirementProgress): number {
  if (node.requiredCredits <= 0) return 100;
  return Math.min(100, Math.round(((node.earnedCredits + node.plannedCredits) / node.requiredCredits) * 100));
}

/** 相对时间：`刚刚` / `3 分钟前` / `昨天` / `3 天前` / 具体日期。 */
export function formatRelativeTime(iso?: string, now: Date = new Date()): string {
  if (!iso) return '从未';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '未知';
  const diff = now.getTime() - date.getTime();
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 172_800_000) return '昨天';
  if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)} 天前`;
  return date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}

export function formatDateTime(iso?: string): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function pluralCourses(count: number): string {
  return `${count} 门`;
}
