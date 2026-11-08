import { reactive } from 'vue';

export interface ToastItem {
  id: number;
  text: string;
  tone: 'ok' | 'error' | 'info';
  action?: { label: string; run: () => void };
}

const state = reactive<{ items: ToastItem[] }>({ items: [] });
let seed = 0;

export function toast(text: string, tone: ToastItem['tone'] = 'info', action?: ToastItem['action']): void {
  const id = ++seed;
  state.items.push({ id, text, tone, action });
  setTimeout(() => {
    const index = state.items.findIndex((item) => item.id === id);
    if (index >= 0) state.items.splice(index, 1);
  }, action ? 6000 : 3200);
}

export function dismissToast(id: number): void {
  const index = state.items.findIndex((item) => item.id === id);
  if (index >= 0) state.items.splice(index, 1);
}

export function useToasts() {
  return state;
}
