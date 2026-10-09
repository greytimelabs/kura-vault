import { create } from 'zustand';
import type { SessionUser } from '@/lib/api/types';

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

interface AuthState {
  status: AuthStatus;
  user: SessionUser | null;
  setSession(user: SessionUser): void;
  clearSession(): void;
  /** Between accounts: the next one's session is being restored. */
  setLoading(): void;
}

export const useAuthStore = create<AuthState>((set) => ({
  status: 'loading',
  user: null,
  setSession: (user) => set({ status: 'authenticated', user }),
  clearSession: () => set({ status: 'unauthenticated', user: null }),
  setLoading: () => set({ status: 'loading', user: null }),
}));

/** The server owner: the one account that manages users. Says nothing about any vault. */
export const useIsOwner = () => useAuthStore((s) => s.user?.role === 'owner');

/** Owner and full-access users may create vaults; limited users only use what is shared with them. */
export const useCanCreateVaults = () =>
  useAuthStore((s) => s.user?.role === 'owner' || s.user?.accessLevel === 'full');
