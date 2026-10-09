import type { AccessLevel, RefreshResponse, SessionUser, UserRole } from './types';
import { MULTI_SERVER } from '../config';
import { apiBaseOf } from '../serverUrl';
import { accounts } from '@/state/accountStore';

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api/v1';
const REFRESH_LOCK = 'mv-auth-refresh';
const MAX_RATE_LIMIT_RETRIES = 4;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** The request never reached the server (offline, DNS, server down). */
export class NetworkError extends Error {
  constructor() {
    super('Could not connect to server');
    this.name = 'NetworkError';
  }
}

// The access token lives only in this module's memory: never in storage, never in
// the DOM. The refresh token is an httpOnly cookie this code cannot read at all;
// only the multi-server client keeps it in storage instead (see lib/config.ts).
let accessToken: string | null = null;
let sessionLostHandler: (() => void) | null = null;

// Multi-server only: the account every request is made for. Null in the
// same-origin client, which has exactly one server.
let activeAccount: { id: string; apiBase: string } | null = null;

/**
 * Point the client at an account's server (multi-server only). The previous
 * account's access token is dropped; the next request refreshes for the new one.
 */
export function setActiveAccount(account: { id: string; serverUrl: string } | null): void {
  activeAccount = account ? { id: account.id, apiBase: apiBaseOf(account.serverUrl) } : null;
  accessToken = null;
}

const currentBase = () => activeAccount?.apiBase ?? API_BASE;

/** A request that was still running when the user switched accounts. Its answer belongs to nobody. */
function assertSameAccount(id: string | null): void {
  if ((activeAccount?.id ?? null) !== id) throw new DOMException('Account changed', 'AbortError');
}

interface JwtClaims {
  sub: string;
  username: string;
  role: UserRole;
  accessLevel: AccessLevel;
  exp: number;
}

function decodeClaims(token: string): JwtClaims | null {
  try {
    const payload = token.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(
      Array.from(atob(payload), (c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join(''),
    );
    return JSON.parse(json) as JwtClaims;
  } catch {
    return null;
  }
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

/** Who the current access token says we are. Display only; the server enforces roles. */
export function currentUser(): SessionUser | null {
  const claims = accessToken ? decodeClaims(accessToken) : null;
  return claims
    ? { id: claims.sub, username: claims.username, role: claims.role, accessLevel: claims.accessLevel }
    : null;
}

export function onSessionLost(handler: () => void): void {
  sessionLostHandler = handler;
}

function tokenExpiresWithin(ms: number): boolean {
  if (!accessToken) return true;
  const claims = decodeClaims(accessToken);
  return !claims || claims.exp * 1000 - Date.now() < ms;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  query?: Record<string, string | number | undefined | null>;
  body?: unknown;
  /** False for login, setup, invites and refresh, which carry no bearer token. */
  auth?: boolean;
  headers?: Record<string, string>;
  /** Server to call instead of the active account's: signing in before an account exists. */
  serverUrl?: string;
  signal?: AbortSignal;
}

function buildUrl(base: string, path: string, query?: RequestOptions['query']): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null) params.set(key, String(value));
  }
  const qs = params.toString();
  return `${base}${path}${qs ? `?${qs}` : ''}`;
}

async function send(path: string, opts: RequestOptions, withAuth: boolean): Promise<Response> {
  const headers: Record<string, string> = { Accept: 'application/json', ...opts.headers };
  // `X-Client: web` asks the server for the cookie flow, which only works same-origin.
  // Without it the server exchanges the refresh token in the body, as it does for the app.
  if (!MULTI_SERVER) headers['X-Client'] = 'web';
  const base = opts.serverUrl ? apiBaseOf(opts.serverUrl) : currentBase();
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (withAuth && accessToken) headers.Authorization = `Bearer ${accessToken}`;

  for (let attempt = 0; ; attempt++) {
    let response: Response;
    try {
      response = await fetch(buildUrl(base, path, opts.query), {
        method: opts.method ?? 'GET',
        headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        credentials: MULTI_SERVER ? 'omit' : 'include',
        cache: 'no-store',
        signal: opts.signal,
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') throw err;
      throw new NetworkError();
    }

    // The API allows a fixed number of requests per minute; wait as told and try again
    if (response.status === 429 && attempt < MAX_RATE_LIMIT_RETRIES) {
      const retryAfter = Number(response.headers.get('Retry-After'));
      const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt;
      await sleep(Math.min(wait, 30_000));
      continue;
    }
    return response;
  }
}

async function toError(response: Response): Promise<ApiError> {
  let message = 'Something went wrong';
  try {
    const body = (await response.json()) as { message?: string | string[] };
    if (Array.isArray(body.message)) message = body.message.join('. ');
    else if (typeof body.message === 'string') message = body.message;
  } catch {
    // non-JSON error body; keep the generic message
  }
  return new ApiError(response.status, message);
}

async function unwrap<T>(response: Response): Promise<T> {
  if (!response.ok) throw await toError(response);
  const json = (await response.json()) as { data: T };
  return json.data;
}

let refreshInFlight: { accountId: string | null; promise: Promise<boolean> } | null = null;

async function doRefresh(): Promise<boolean> {
  const response = await send('/auth/refresh', { method: 'POST', body: {} }, false);
  if (response.ok) {
    const { data } = (await response.json()) as { data: RefreshResponse };
    accessToken = data.accessToken;
    return true;
  }
  if (response.status === 401 || response.status === 403) {
    accessToken = null;
    return false;
  }
  throw await toError(response);
}

/**
 * Multi-server refresh: exchange the account's stored refresh token. The token is
 * read here, inside the lock, so a tab that waited its turn presents the token the
 * previous tab was just given rather than the one that tab used up.
 */
async function doAccountRefresh(account: { id: string; apiBase: string }): Promise<boolean> {
  const refreshToken = accounts.refreshToken(account.id);
  if (!refreshToken) return false;

  const response = await send('/auth/refresh', { method: 'POST', body: { refreshToken } }, false);
  if (response.ok) {
    const { data } = (await response.json()) as { data: RefreshResponse & { refreshToken: string } };
    accounts.setRefreshToken(account.id, data.refreshToken);
    if (activeAccount?.id === account.id) accessToken = data.accessToken;
    return true;
  }
  if (response.status === 401 || response.status === 403) {
    accounts.setRefreshToken(account.id, null);
    if (activeAccount?.id === account.id) accessToken = null;
    return false;
  }
  throw await toError(response);
}

/**
 * Exchange the refresh cookie for a new access token.
 * Resolves false when the server says the session is over; throws on network failure
 * so being offline never signs anyone out.
 *
 * Refresh tokens rotate on use, so two tabs refreshing at once would have one of
 * them present an already-used token. A Web Lock makes tabs take turns.
 */
export function refreshSession(): Promise<boolean> {
  const account = activeAccount;
  const accountId = account?.id ?? null;
  if (MULTI_SERVER && !account) return Promise.resolve(false);

  if (!refreshInFlight || refreshInFlight.accountId !== accountId) {
    const run = () => (account ? doAccountRefresh(account) : doRefresh());
    const lockName = account ? `${REFRESH_LOCK}:${account.id}` : REFRESH_LOCK;
    const locked: Promise<boolean> = navigator.locks
      ? (navigator.locks.request(lockName, run) as Promise<boolean>)
      : run();
    const entry = {
      accountId,
      promise: locked.finally(() => {
        if (refreshInFlight === entry) refreshInFlight = null;
      }),
    };
    refreshInFlight = entry;
  }
  return refreshInFlight.promise;
}

export async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const auth = opts.auth ?? true;
  if (!auth) {
    return unwrap<T>(await send(path, opts, false));
  }

  // Every await below may span an account switch; the request then stops rather
  // than go out to the new account's server with the new account's token.
  const accountId = activeAccount?.id ?? null;

  // Refresh ahead of expiry rather than spending a request on a guaranteed 401
  if (tokenExpiresWithin(20_000)) {
    const ok = await refreshSession();
    assertSameAccount(accountId);
    if (!ok) {
      sessionLostHandler?.();
      throw new ApiError(401, 'Session expired');
    }
  }

  let response = await send(path, opts, true);
  assertSameAccount(accountId);
  if (response.status === 401) {
    const ok = await refreshSession();
    assertSameAccount(accountId);
    if (!ok) {
      sessionLostHandler?.();
      throw new ApiError(401, 'Session expired');
    }
    response = await send(path, opts, true);
    assertSameAccount(accountId);
    if (response.status === 401) {
      sessionLostHandler?.();
    }
  }
  return unwrap<T>(response);
}

export function errorMessage(err: unknown, fallback = 'Something went wrong'): string {
  if (err instanceof ApiError || err instanceof NetworkError) return err.message;
  return fallback;
}
