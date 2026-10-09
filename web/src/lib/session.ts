// The few operations that cut across every store: unlocking, locking, signing in and out.
import { authApi, vaultApi } from './api/endpoints';
import { NetworkError, currentUser, onSessionLost, refreshSession, setAccessToken } from './api/client';
import { cryptoCall, destroyKeys } from './crypto/cryptoClient';
import type { VaultMatch } from './crypto/protocol';
import { clearPreviewUrls } from './media/previewLoader';
import { clearThumbUrls } from './media/thumbLoader';
import { clearThumbStore } from './media/thumbStore';
import { queryClient } from './queryClient';
import { cancelAllUploads } from './upload/uploadQueue';
import { useAuthStore } from '@/state/authStore';
import { rememberedDeviceId, sessionHint } from '@/state/preferences';
import { useSelectionStore } from '@/state/selectionStore';
import { useVaultStore } from '@/state/vaultStore';

/**
 * Lock the vault: destroy the keys, then everything that was decrypted with them.
 * After this the page holds no key material and no decrypted media.
 */
export function lockVault(): void {
  cancelAllUploads();
  destroyKeys();
  clearThumbUrls();
  clearPreviewUrls();
  queryClient.clear();
  useSelectionStore.getState().clear();
  useVaultStore.getState().setLocked();
}

function endSession(): void {
  lockVault();
  setAccessToken(null);
  sessionHint.set(false);
  useVaultStore.getState().setReturnTo(null);
  useAuthStore.getState().clearSession();
}

/** Restore the session from the refresh cookie when the page loads. */
export async function bootstrapSession(): Promise<void> {
  onSessionLost(endSession);

  if (!sessionHint.get()) {
    useAuthStore.getState().clearSession();
    return;
  }

  try {
    const ok = await refreshSession();
    const user = ok ? currentUser() : null;
    if (user) {
      useAuthStore.getState().setSession(user);
      return;
    }
    sessionHint.set(false);
  } catch (err) {
    // Offline at load: keep the hint so the next load tries again
    if (!(err instanceof NetworkError)) sessionHint.set(false);
  }
  useAuthStore.getState().clearSession();
}

export async function signIn(deviceId: string, password: string): Promise<void> {
  const result = await authApi.login(deviceId, password);
  setAccessToken(result.accessToken);
  rememberedDeviceId.set(deviceId);
  sessionHint.set(true);
  useAuthStore.getState().setSession({ id: result.user.id, deviceId, role: result.user.role });
}

/** Sign out: revoke this session on the server and clear all local data, cache included. */
export async function signOut(): Promise<void> {
  try {
    await authApi.logout();
  } catch {
    // Best effort; local state is cleared regardless
  }
  endSession();
  await clearThumbStore();
}

/**
 * Check a passphrase against every vault. An empty result means "wrong passphrase";
 * callers must not say anything more specific than that.
 */
export async function findVaultMatches(passphrase: string): Promise<VaultMatch[]> {
  const vaults = await vaultApi.list();
  return cryptoCall('findMatches', { passphrase, vaults });
}

/** Commit one match as the open vault. The keys of the other matches are dropped. */
export async function openVault(match: VaultMatch): Promise<void> {
  await cryptoCall('selectVault', { vaultId: match.vaultId });
  useVaultStore.getState().setUnlocked(match.vaultId, match.label);
}

export function discardVaultMatches(): void {
  void cryptoCall('discardMatches', {}).catch(() => undefined);
}

/** Create a vault on the server. Its key stays in the worker as a candidate for `openVault`. */
export async function createVault(passphrase: string, label: string): Promise<VaultMatch> {
  const info = await cryptoCall('createVault', { passphrase, label });
  try {
    await vaultApi.create({
      id: info.id,
      kekSalt: info.kekSalt,
      kekVerify: info.kekVerify,
      kekVerifyNonce: info.kekVerifyNonce,
      ...(info.labelEncrypted && info.labelNonce
        ? { labelEncrypted: info.labelEncrypted, labelNonce: info.labelNonce }
        : {}),
    });
  } catch (err) {
    discardVaultMatches();
    throw err;
  }
  return { vaultId: info.id, label: label.trim() || 'New vault' };
}
