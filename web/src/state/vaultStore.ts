import { create } from 'zustand';

/** What is open: a whole vault, or one album of a vault the user has no other access to. */
export interface OpenSpace {
  vaultId: string;
  label: string;
  canWrite: boolean;
  /** Created the vault: may share it and its albums. */
  isCreator: boolean;
  /** Set when only this album is shared with the user. */
  albumId: string | null;
}

interface VaultState {
  /** The master passphrase has been entered: the account's private keys are in the worker. */
  accountUnlocked: boolean;
  /** A vault or shared album is open. */
  unlocked: boolean;
  vaultId: string | null;
  label: string | null;
  canWrite: boolean;
  isCreator: boolean;
  albumId: string | null;
  /** The user chose to leave the vault, so what opens next starts at its first screen. */
  closedByUser: boolean;
  /** Where the user was heading when asked for a passphrase. Memory only. */
  returnTo: string | null;
  setAccountUnlocked(): void;
  setUnlocked(space: OpenSpace): void;
  /** Leave the open vault; the account stays unlocked. */
  setClosed(): void;
  /** Everything locked: no keys remain. */
  setLocked(): void;
  setReturnTo(path: string | null): void;
}

const CLOSED = { unlocked: false, vaultId: null, label: null, canWrite: false, isCreator: false, albumId: null };

export const useVaultStore = create<VaultState>((set) => ({
  accountUnlocked: false,
  ...CLOSED,
  closedByUser: false,
  returnTo: null,
  setAccountUnlocked: () => set({ accountUnlocked: true }),
  setUnlocked: (space) => set({ accountUnlocked: true, unlocked: true, closedByUser: false, ...space }),
  setClosed: () => set({ ...CLOSED, closedByUser: true }),
  setLocked: () => set({ accountUnlocked: false, closedByUser: false, ...CLOSED }),
  setReturnTo: (returnTo) => set({ returnTo }),
}));

/** The open vault's id. Only call from screens rendered inside the unlocked shell. */
export function useVaultId(): string {
  const vaultId = useVaultStore((s) => s.vaultId);
  if (!vaultId) throw new Error('No vault is open');
  return vaultId;
}

/** May upload here. In a shared album that means into that album only. */
export const useCanWrite = () => useVaultStore((s) => s.canWrite);

/** Has the whole vault and may change it: create albums, move items between them. */
export const useCanOrganise = () => useVaultStore((s) => s.canWrite && s.albumId === null);

export const useIsCreator = () => useVaultStore((s) => s.isCreator);

/** The one album open when only an album is shared with the user; null inside a whole vault. */
export const useAlbumOnlyId = () => useVaultStore((s) => s.albumId);
