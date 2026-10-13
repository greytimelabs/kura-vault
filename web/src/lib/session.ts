// The few operations that cut across every store: unlocking, locking, signing in and out.
import { albumApi, authApi, inviteApi, meApi, serverApi, userApi, vaultApi } from './api/endpoints';
import {
  NetworkError,
  currentUser,
  onSessionLost,
  refreshSession,
  revokeAccountSession,
  setAccessToken,
  setActiveAccount,
} from './api/client';
import { MULTI_SERVER } from './config';
import { forgetAlbumKeys, markAlbumKeyLoaded } from './albums';
import type { AccessLevel, SharePermission } from './api/types';
import { b64decode, b64encode } from './crypto/base64';
import { cryptoCall, destroyKeys } from './crypto/cryptoClient';
import { inviteAuthToken } from './crypto/identity';
import type { VaultMatch } from './crypto/protocol';
import { encodeInviteLink, type InviteLink } from './invite';
import { clearPreviewUrls } from './media/previewLoader';
import { clearThumbUrls } from './media/thumbLoader';
import { clearThumbStore } from './media/thumbStore';
import { queryClient } from './queryClient';
import { parseServerUrl } from './serverUrl';
import { cancelAllUploads } from './upload/uploadQueue';
import { accounts, type Account } from '@/state/accountStore';
import { useAuthStore } from '@/state/authStore';
import { rememberedUsername, sessionHint } from '@/state/preferences';
import { useSelectionStore } from '@/state/selectionStore';
import { toast } from '@/state/toastStore';
import { useVaultStore } from '@/state/vaultStore';

/** Everything that was decrypted with the open vault's keys. */
function clearDecrypted(): void {
  cancelAllUploads();
  forgetAlbumKeys();
  clearThumbUrls();
  clearPreviewUrls();
  queryClient.clear();
  useSelectionStore.getState().clear();
}

/**
 * Lock: destroy every key (the account's private keys included), then everything
 * that was decrypted with them. After this the page holds no key material and no
 * decrypted media, and the master passphrase is needed again.
 */
export function lockVault(): void {
  destroyKeys();
  clearDecrypted();
  useVaultStore.getState().setLocked();
}

/**
 * Leave the open vault but stay unlocked. A vault opened with its passphrase
 * needs it again; what was shared with the account stays one click away.
 */
export function closeVault(): void {
  const { vaultId, isCreator } = useVaultStore.getState();
  clearDecrypted();
  useVaultStore.getState().setClosed();
  if (vaultId && isCreator) void cryptoCall('closeVault', { vaultId }).catch(() => undefined);
}

function endSession(): void {
  lockVault();
  setAccessToken(null);
  sessionHint.set(false);
  useVaultStore.getState().setReturnTo(null);
  if (MULTI_SERVER) {
    // The account stays listed, so signing back in only needs the password
    const id = accounts.activeId();
    if (id) accounts.markSignedOut(id);
  }
  useAuthStore.getState().clearSession();
}

/** Where a signed-out visitor goes to sign in. */
export function loginPath(serverUrl: string, options: { username?: string; add?: boolean } = {}): string {
  const params = new URLSearchParams({ server: serverUrl });
  if (options.username) params.set('username', options.username);
  if (options.add) params.set('add', '1');
  return `/login?${params.toString()}`;
}

export function signInPath(): string {
  if (!MULTI_SERVER) return '/login';
  const active = accounts.active();
  return active ? loginPath(active.serverUrl, { username: active.username }) : '/server';
}

/**
 * Multi-server: make `account` the one every request is made for and restore its
 * session from its stored refresh token.
 */
async function activate(account: Account | null): Promise<void> {
  setActiveAccount(account);
  if (!account?.signedIn) {
    useAuthStore.getState().clearSession();
    return;
  }

  try {
    const ok = await refreshSession();
    // The user switched again while this one was being restored
    if (accounts.activeId() !== account.id) return;
    const user = ok ? currentUser() : null;
    if (user) {
      useAuthStore.getState().setSession(user);
      return;
    }
    accounts.markSignedOut(account.id);
  } catch {
    // Offline: the account stays signed in and the next load tries again
    if (accounts.activeId() !== account.id) return;
  }
  useAuthStore.getState().clearSession();
}

/**
 * Multi-server: confirm that what the user typed is a Kura Vault server.
 * Returns the cleaned-up server address; throws an Error whose message can be shown.
 */
export async function checkServer(input: string): Promise<string> {
  const serverUrl = parseServerUrl(input);
  let info;
  try {
    info = await serverApi.info(serverUrl);
  } catch (err) {
    // A server that does not list this site in CORS_ORIGINS looks the same to a browser as one that is down
    if (err instanceof NetworkError) {
      throw new Error('Could not reach the server. Check the address, and that the server allows this site.');
    }
    // It answered, but not the way a Kura Vault server does
    throw new Error('This does not look like a Kura Vault server');
  }
  if (info.app !== 'kura-vault') throw new Error('This does not look like a Kura Vault server');
  return serverUrl;
}

/** Multi-server: change to another account. The open vault is locked first. */
export async function switchAccount(id: string): Promise<void> {
  const account = accounts.byId(id);
  if (!account || id === accounts.activeId()) return;

  lockVault();
  useVaultStore.getState().setReturnTo(null);
  accounts.setActive(id);
  useAuthStore.getState().setLoading();
  await activate(account);
}

/**
 * Multi-server: sign out of an account if needed and forget it in this browser.
 * For an account that is not the active one the token is only deleted here; with
 * no copy left anywhere it can never be used and simply expires on its server.
 */
export async function removeAccount(id: string): Promise<void> {
  if (id === accounts.activeId()) await signOut();
  const activeBefore = accounts.activeId();
  accounts.remove(id);
  if (accounts.activeId() !== activeBefore) await activate(accounts.active());
}

/**
 * Multi-server: sign out of an account but keep it in the list, so signing back
 * in only needs the password. For an account that is not the active one, its
 * session is ended on its own server; if that server cannot be reached the token
 * is still deleted here, and with no copy left it can never be used.
 */
export async function signOutAccount(id: string): Promise<void> {
  if (id === accounts.activeId()) {
    await signOut();
    return;
  }
  const account = accounts.byId(id);
  if (!account?.signedIn) return;
  try {
    await revokeAccountSession(account);
  } catch {
    // Best effort; the local token is deleted regardless
  }
  accounts.markSignedOut(id);
}

/** Restore the session when the page loads: from the refresh cookie, or from the active account. */
export async function bootstrapSession(): Promise<void> {
  onSessionLost(endSession);

  if (MULTI_SERVER) {
    await activate(accounts.active());
    return;
  }

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

/**
 * `serverUrl` is required by the multi-server client and unused otherwise.
 * `keepKeys` is for an account created a moment ago, whose keys are already in the worker.
 */
export async function signIn(
  username: string,
  password: string,
  serverUrl?: string,
  options: { keepKeys?: boolean } = {},
): Promise<void> {
  if (MULTI_SERVER) {
    if (!serverUrl) throw new Error('No server chosen');
    const result = await authApi.login(username, password, serverUrl);
    if (!result.refreshToken) throw new Error('The server did not start a session');

    // Signing in may be adding a second account: leave the current one cleanly
    if (!options.keepKeys) lockVault();
    useVaultStore.getState().setReturnTo(null);
    const account = accounts.saveSignIn({
      serverUrl,
      username,
      role: result.user.role,
      refreshToken: result.refreshToken,
    });
    setActiveAccount(account);
    setAccessToken(result.accessToken);
    useAuthStore.getState().setSession(result.user);
    return;
  }

  const result = await authApi.login(username, password);
  setAccessToken(result.accessToken);
  rememberedUsername.set(username);
  sessionHint.set(true);
  useAuthStore.getState().setSession(result.user);
}

/** Sign out: revoke this session on the server and clear all local data, cache included. */
export async function signOut(): Promise<void> {
  const accountId = MULTI_SERVER ? accounts.activeId() : null;
  try {
    await authApi.logout(accountId ? accounts.refreshToken(accountId) : null);
  } catch {
    // Best effort; local state is cleared regardless
  }
  endSession();
  await clearThumbStore();

  // Another account is still signed in: carry on there instead of a sign-in page
  const next = accountId ? accounts.otherSignedIn(accountId) : null;
  if (next) await switchAccount(next.id);
}

// ── Accounts ──

/** A password equal to the master passphrase would hand the server the one secret it must never see. */
export function assertDistinctSecrets(password: string, passphrase: string): void {
  if (password === passphrase) {
    throw new Error('The master passphrase must be different from the password');
  }
}

/** First-run setup: create the server's owner account with the setup key, then sign in as it. */
export async function setupOwner(input: {
  setupKey: string;
  username: string;
  password: string;
  passphrase: string;
  serverUrl?: string;
}): Promise<void> {
  assertDistinctSecrets(input.password, input.passphrase);
  lockVault();
  const id = crypto.randomUUID();
  const username = input.username.trim().toLowerCase();
  const { keyCert, keyBinding: _none, ...keys } = await cryptoCall('createAccount', {
    userId: id,
    username,
    passphrase: input.passphrase,
  });
  try {
    await serverApi.setup(
      { setupKey: input.setupKey.trim(), id, username, password: input.password, keyCert: keyCert!, ...keys },
      input.serverUrl,
    );
    await signIn(username, input.password, input.serverUrl, { keepKeys: true });
  } catch (err) {
    lockVault();
    throw err;
  }
  // The keys made a moment ago are still in the worker: no need to ask for the passphrase again
  useVaultStore.getState().setAccountUnlocked();
}

/** What the server says about an invite link, after checking it names the owner the link names. */
export async function readInvite(invite: InviteLink, serverUrl?: string) {
  const token = b64encode(await inviteAuthToken(b64decode(invite.secret)));
  const info = await inviteApi.get(invite.inviteId, token, serverUrl);
  if (info.ownerPublicSignKey !== invite.ownerSignKey) {
    throw new Error('This server is not the one the invite was made for. Do not continue.');
  }
  return { info, token };
}

/** Accept an invite: create this user's keys, bind them to the link, and sign in. */
export async function acceptInvite(input: {
  invite: InviteLink;
  password: string;
  passphrase: string;
  serverUrl?: string;
}): Promise<void> {
  assertDistinctSecrets(input.password, input.passphrase);
  const { info, token } = await readInvite(input.invite, input.serverUrl);
  lockVault();
  const { keyCert: _none, keyBinding, ...keys } = await cryptoCall('createAccount', {
    userId: info.userId,
    username: info.username,
    passphrase: input.passphrase,
    invite: { secret: input.invite.secret, ownerSignKey: input.invite.ownerSignKey },
  });
  try {
    await inviteApi.accept(
      input.invite.inviteId,
      { token, password: input.password, keyBinding: keyBinding!, ...keys },
      input.serverUrl,
    );
    await signIn(info.username, input.password, input.serverUrl, { keepKeys: true });
  } catch (err) {
    lockVault();
    throw err;
  }
  useVaultStore.getState().setAccountUnlocked();
}

/**
 * Enter the master passphrase: load the account's private keys into the worker.
 * False means it was wrong. The server takes no part and cannot tell.
 */
export async function unlockAccount(passphrase: string): Promise<boolean> {
  const me = await meApi.get();
  const ok = await cryptoCall('unlockAccount', {
    account: {
      id: me.id,
      kdfSalt: me.kdfSalt,
      encryptedPrivateKeys: me.encryptedPrivateKeys,
      privateKeysNonce: me.privateKeysNonce,
      publicEncKey: me.publicEncKey,
      publicSignKey: me.publicSignKey,
    },
    passphrase,
  });
  if (!ok) return false;
  useVaultStore.getState().setAccountUnlocked();
  if (me.role === 'owner') void certifyPendingUsers().catch(() => undefined);
  return true;
}

// ── Users (owner) ──

/**
 * Verify and sign the keys of everyone who joined since the owner last
 * unlocked. Until this has happened nothing can be shared with them. Returns
 * the usernames whose keys were NOT the ones bound to their invite link.
 */
export async function certifyPendingUsers(): Promise<string[]> {
  const { users } = await userApi.list();
  const rejected: string[] = [];
  for (const user of users) {
    if (!user.verification) continue;
    const keyCert = await cryptoCall('certifyUser', {
      user: {
        userId: user.userId,
        username: user.username,
        publicEncKey: user.publicEncKey,
        publicSignKey: user.publicSignKey,
      },
      verification: user.verification,
    });
    if (keyCert) await userApi.certify(user.userId, keyCert);
    else rejected.push(user.username);
  }
  if (rejected.length > 0) {
    toast(`Keys could not be verified for: ${rejected.join(', ')}. Restrict the account and invite again.`, 'error');
  }
  if (users.some((user) => user.verification) && rejected.length === 0) {
    void queryClient.invalidateQueries({ queryKey: ['users'] });
  }
  return rejected;
}

/** Create an invitation and the link to hand over. The link is shown once and cannot be recovered. */
export async function inviteUser(username: string, accessLevel: AccessLevel): Promise<string> {
  const inviteId = crypto.randomUUID();
  const material = await cryptoCall('createInvite', { inviteId });
  await userApi.invite({
    id: inviteId,
    username: username.trim().toLowerCase(),
    accessLevel,
    tokenHash: material.tokenHash,
    ownerSecretEncrypted: material.ownerSecretEncrypted,
  });
  void queryClient.invalidateQueries({ queryKey: ['users'] });
  return encodeInviteLink(window.location.origin, {
    // Which server to join: the mobile app and a client hosted apart from the
    // server cannot know otherwise. This build is served by its own server.
    server: MULTI_SERVER ? (accounts.active()?.serverUrl ?? null) : window.location.origin,
    inviteId,
    secret: material.secret,
    ownerSignKey: material.ownerSignKey,
  });
}

// ── Vaults and shared albums ──

/** Something another user shared with this account: a whole vault, or one album. */
export interface SharedSpace {
  kind: 'vault' | 'album';
  id: string;
  vaultId: string;
  label: string;
  permission: SharePermission;
  sharedBy: string;
}

/**
 * Open everything shared with this account. Each share is used only if its
 * sender's keys are certified by the owner and they signed it; the rest are
 * left out, so a key planted by the server never reaches the keyring.
 */
export async function loadSharedSpaces(): Promise<SharedSpace[]> {
  const [vaults, albums] = await Promise.all([vaultApi.list(), albumApi.shared()]);
  const sharedVaults = vaults.filter((v) => v.role === 'member');
  const [labels, names] = await Promise.all([
    cryptoCall('openSharedVaults', { vaults: sharedVaults }),
    cryptoCall('openSharedAlbums', { albums }),
  ]);
  const vaultIds = new Set(sharedVaults.map((v) => v.id));
  const spaces: SharedSpace[] = [];
  sharedVaults.forEach((vault, i) => {
    const label = labels[i];
    if (label === null || label === undefined) return;
    spaces.push({
      kind: 'vault',
      id: vault.id,
      vaultId: vault.id,
      label,
      permission: vault.permission,
      sharedBy: vault.granter?.username ?? '',
    });
  });
  albums.forEach((album, i) => {
    const name = names[i];
    // An album inside a vault that is shared as a whole is reached through the vault
    if (name === null || name === undefined) return;
    markAlbumKeyLoaded(album.id);
    if (vaultIds.has(album.vaultId)) return;
    spaces.push({
      kind: 'album',
      id: album.id,
      vaultId: album.vaultId,
      label: name,
      permission: album.permission,
      sharedBy: album.granter?.username ?? '',
    });
  });
  return spaces;
}

export function openSharedSpace(space: SharedSpace): void {
  useVaultStore.getState().setUnlocked({
    vaultId: space.vaultId,
    label: space.label,
    canWrite: space.permission === 'write',
    isCreator: false,
    albumId: space.kind === 'album' ? space.id : null,
  });
}

/**
 * Check a vault passphrase against every vault this account created. An empty
 * result means "wrong passphrase"; callers must not say anything more specific.
 */
export async function findVaultMatches(passphrase: string): Promise<VaultMatch[]> {
  const vaults = (await vaultApi.list()).filter(
    (v): v is typeof v & { kdfSalt: string } => v.role === 'creator' && v.kdfSalt !== null,
  );
  return cryptoCall('findMatches', { passphrase, vaults });
}

/** Commit one match as the open vault. The keys of the other matches are dropped. */
export async function openVault(match: VaultMatch): Promise<void> {
  await cryptoCall('selectVault', { vaultId: match.vaultId });
  useVaultStore.getState().setUnlocked({
    vaultId: match.vaultId,
    label: match.label,
    canWrite: true,
    isCreator: true,
    albumId: null,
  });
}

export function discardVaultMatches(): void {
  void cryptoCall('discardMatches').catch(() => undefined);
}

/** Create a vault on the server. Its key stays in the worker as a candidate for `openVault`. */
export async function createVault(passphrase: string, label: string): Promise<VaultMatch> {
  const vault = await cryptoCall('createVault', { passphrase, label });
  try {
    await vaultApi.create({
      id: vault.id,
      wrappedKey: vault.wrappedKey,
      kdfSalt: vault.kdfSalt,
      ...(vault.labelEncrypted && vault.labelNonce
        ? { labelEncrypted: vault.labelEncrypted, labelNonce: vault.labelNonce }
        : {}),
    });
  } catch (err) {
    discardVaultMatches();
    throw err;
  }
  return { vaultId: vault.id, label: label.trim() || 'New vault' };
}

/**
 * Delete the open vault with everything in it, for everyone it is shared with.
 * The vault passphrase is checked here first, so an unlocked screen left alone
 * is not enough to destroy a vault. Resolves false when the passphrase is wrong.
 */
export async function deleteOpenVault(passphrase: string): Promise<boolean> {
  const { vaultId, isCreator } = useVaultStore.getState();
  if (!vaultId || !isCreator) throw new Error('Only the creator of a vault can delete it');

  const own = (await vaultApi.list()).filter(
    (v): v is typeof v & { kdfSalt: string } => v.id === vaultId && v.role === 'creator' && v.kdfSalt !== null,
  );
  const matches = await cryptoCall('findMatches', { passphrase, vaults: own });
  discardVaultMatches();
  if (!matches.some((match) => match.vaultId === vaultId)) return false;

  await vaultApi.remove(vaultId);
  closeVault();
  return true;
}

/** Whether a server still needs its owner account created. False when it cannot be asked. */
export async function serverNeedsSetup(serverUrl?: string): Promise<boolean> {
  try {
    return (await serverApi.info(serverUrl)).setupRequired === true;
  } catch {
    return false;
  }
}
