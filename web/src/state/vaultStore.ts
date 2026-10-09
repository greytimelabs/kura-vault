import { create } from 'zustand';

interface VaultState {
  unlocked: boolean;
  vaultId: string | null;
  label: string | null;
  /** Where the user was heading when asked for the passphrase. Memory only. */
  returnTo: string | null;
  setUnlocked(vaultId: string, label: string): void;
  setLocked(): void;
  setReturnTo(path: string | null): void;
}

export const useVaultStore = create<VaultState>((set) => ({
  unlocked: false,
  vaultId: null,
  label: null,
  returnTo: null,
  setUnlocked: (vaultId, label) => set({ unlocked: true, vaultId, label }),
  setLocked: () => set({ unlocked: false, vaultId: null, label: null }),
  setReturnTo: (returnTo) => set({ returnTo }),
}));

/** The unlocked vault's id. Only call from screens rendered inside the unlocked shell. */
export function useVaultId(): string {
  const vaultId = useVaultStore((s) => s.vaultId);
  if (!vaultId) throw new Error('No vault is unlocked');
  return vaultId;
}
