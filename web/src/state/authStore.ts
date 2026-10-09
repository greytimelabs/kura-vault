import { create } from 'zustand';
import type { SessionUser } from '@/lib/api/types';

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

interface AuthState {
  status: AuthStatus;
  user: SessionUser | null;
  setSession(user: SessionUser): void;
  clearSession(): void;
}

export const useAuthStore = create<AuthState>((set) => ({
  status: 'loading',
  user: null,
  setSession: (user) => set({ status: 'authenticated', user }),
  clearSession: () => set({ status: 'unauthenticated', user: null }),
}));

export const useIsOwner = () => useAuthStore((s) => s.user?.role === 'owner');
