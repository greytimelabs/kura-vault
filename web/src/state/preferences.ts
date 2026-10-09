import { create } from 'zustand';

export type ThemeChoice = 'system' | 'light' | 'dark';

const THEME_KEY = 'mv_theme';
const AUTO_LOCK_KEY = 'mv_autolock_minutes';
const DEVICE_ID_KEY = 'mv_device_id';
const SESSION_HINT_KEY = 'mv_session';

export const AUTO_LOCK_OPTIONS = [5, 15, 60, 0] as const; // 0 = never
const DEFAULT_AUTO_LOCK = 15;

// Storage can throw (blocked cookies, private mode). Preferences are never essential.
function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // ignore
  }
}

function readTheme(): ThemeChoice {
  const value = read(THEME_KEY);
  return value === 'light' || value === 'dark' ? value : 'system';
}

function readAutoLock(): number {
  const value = Number(read(AUTO_LOCK_KEY));
  return (AUTO_LOCK_OPTIONS as readonly number[]).includes(value) && read(AUTO_LOCK_KEY) !== null
    ? value
    : DEFAULT_AUTO_LOCK;
}

export function applyTheme(choice: ThemeChoice): void {
  const dark =
    choice === 'dark' || (choice === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

interface PreferencesState {
  theme: ThemeChoice;
  autoLockMinutes: number;
  setTheme(theme: ThemeChoice): void;
  setAutoLockMinutes(minutes: number): void;
}

export const usePreferences = create<PreferencesState>((set) => ({
  theme: readTheme(),
  autoLockMinutes: readAutoLock(),
  setTheme: (theme) => {
    write(THEME_KEY, theme === 'system' ? null : theme);
    applyTheme(theme);
    set({ theme });
  },
  setAutoLockMinutes: (autoLockMinutes) => {
    write(AUTO_LOCK_KEY, String(autoLockMinutes));
    set({ autoLockMinutes });
  },
}));

/** The device ID last used to sign in, to prefill the form. Not a secret. */
export const rememberedDeviceId = {
  get: () => read(DEVICE_ID_KEY) ?? '',
  set: (deviceId: string) => write(DEVICE_ID_KEY, deviceId),
};

/** Whether a refresh cookie probably exists, so a first-time visitor is not sent a pointless refresh. */
export const sessionHint = {
  get: () => read(SESSION_HINT_KEY) === '1',
  set: (present: boolean) => write(SESSION_HINT_KEY, present ? '1' : null),
};
