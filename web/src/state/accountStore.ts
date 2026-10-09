// Accounts on other servers, for the hosted (multi-server) client only.
import { create } from 'zustand';
import type { UserRole } from '@/lib/api/types';

/** One sign-in on one server. The password is never part of this. */
export interface Account {
  id: string;
  /** Server root without the API prefix, e.g. https://vault.example.com */
  serverUrl: string;
  username: string;
  role: UserRole | null;
  /** False once the login expired or the user signed out; the entry is kept. */
  signedIn: boolean;
}

const ACCOUNTS_KEY = 'mv_accounts';
const LAST_ACTIVE_KEY = 'mv_last_account';
// Per tab, so two tabs can sit on different accounts
const TAB_ACTIVE_KEY = 'mv_active_account';
const refreshKey = (id: string) => `mv_refresh.${id}`;

function read(storage: () => Storage, key: string): string | null {
  try {
    return storage().getItem(key);
  } catch {
    return null;
  }
}

function write(storage: () => Storage, key: string, value: string | null): void {
  try {
    if (value === null) storage().removeItem(key);
    else storage().setItem(key, value);
  } catch {
    // Storage blocked: accounts last only as long as the page
  }
}

const local = () => localStorage;
const tab = () => sessionStorage;

function readAccounts(): Account[] {
  try {
    const parsed: unknown = JSON.parse(read(local, ACCOUNTS_KEY) ?? '[]');
    return Array.isArray(parsed) ? (parsed as Account[]) : [];
  } catch {
    return [];
  }
}

function readActiveId(accounts: Account[]): string | null {
  const wanted = read(tab, TAB_ACTIVE_KEY) ?? read(local, LAST_ACTIVE_KEY);
  if (wanted && accounts.some((a) => a.id === wanted)) return wanted;
  return accounts[0]?.id ?? null;
}

interface AccountState {
  accounts: Account[];
  activeId: string | null;
}

const initialAccounts = readAccounts();

export const useAccountStore = create<AccountState>(() => ({
  accounts: initialAccounts,
  activeId: readActiveId(initialAccounts),
}));

function commit(accounts: Account[], activeId: string | null): void {
  write(local, ACCOUNTS_KEY, JSON.stringify(accounts));
  write(tab, TAB_ACTIVE_KEY, activeId);
  write(local, LAST_ACTIVE_KEY, activeId);
  useAccountStore.setState({ accounts, activeId });
}

export const accounts = {
  all: () => useAccountStore.getState().accounts,
  activeId: () => useAccountStore.getState().activeId,
  byId: (id: string | null) => useAccountStore.getState().accounts.find((a) => a.id === id) ?? null,
  active: () => accounts.byId(useAccountStore.getState().activeId),

  /** Record a successful sign-in and make it the active account. Reuses a known server + username. */
  saveSignIn(input: { serverUrl: string; username: string; role: UserRole; refreshToken: string }): Account {
    const all = accounts.all();
    const existing = all.find((a) => a.serverUrl === input.serverUrl && a.username === input.username);
    const account: Account = {
      id: existing?.id ?? crypto.randomUUID(),
      serverUrl: input.serverUrl,
      username: input.username,
      role: input.role,
      signedIn: true,
    };
    accounts.setRefreshToken(account.id, input.refreshToken);
    commit(existing ? all.map((a) => (a.id === account.id ? account : a)) : [...all, account], account.id);
    return account;
  },

  setActive(id: string): void {
    if (accounts.byId(id)) commit(accounts.all(), id);
  },

  refreshToken: (id: string) => read(local, refreshKey(id)),
  setRefreshToken: (id: string, token: string | null) => write(local, refreshKey(id), token),

  /** Drop the account's token but keep its server and username. */
  markSignedOut(id: string): void {
    accounts.setRefreshToken(id, null);
    commit(
      accounts.all().map((a) => (a.id === id ? { ...a, signedIn: false } : a)),
      accounts.activeId(),
    );
  },

  /** Forget the account in this browser. */
  remove(id: string): void {
    accounts.setRefreshToken(id, null);
    const rest = accounts.all().filter((a) => a.id !== id);
    const activeId = accounts.activeId();
    commit(rest, activeId === id ? ((rest.find((a) => a.signedIn) ?? rest[0])?.id ?? null) : activeId);
  },

  /** A signed-in account other than `id`, if any. */
  otherSignedIn: (id: string) => accounts.all().find((a) => a.id !== id && a.signedIn) ?? null,
};

// Another tab added, removed or signed out an account: keep this tab's list current.
// This tab's own active account does not follow the other tab.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== ACCOUNTS_KEY) return;
    const next = readAccounts();
    const activeId = useAccountStore.getState().activeId;
    useAccountStore.setState({
      accounts: next,
      activeId: next.some((a) => a.id === activeId) ? activeId : readActiveId(next),
    });
  });
}
