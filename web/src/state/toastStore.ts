import { create } from 'zustand';

export interface Toast {
  id: number;
  message: string;
  tone: 'info' | 'error';
}

interface ToastState {
  toasts: Toast[];
  dismiss(id: number): void;
}

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

let nextId = 1;

export function toast(message: string, tone: Toast['tone'] = 'info'): void {
  const id = nextId++;
  useToastStore.setState((s) => ({ toasts: [...s.toasts.slice(-3), { id, message, tone }] }));
  setTimeout(() => useToastStore.getState().dismiss(id), tone === 'error' ? 7000 : 4000);
}
