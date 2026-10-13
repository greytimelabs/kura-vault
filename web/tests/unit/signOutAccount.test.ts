import { beforeEach, describe, expect, it, vi } from 'vitest';

function memoryStorage(): Storage {
  const items = new Map<string, string>();
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
    removeItem: (key) => void items.delete(key),
    clear: () => items.clear(),
    key: () => null,
    get length() {
      return items.size;
    },
  };
}

vi.stubGlobal('localStorage', memoryStorage());
vi.stubGlobal('sessionStorage', memoryStorage());

const { accounts } = await import('../../src/state/accountStore');
const { revokeAccountSession, setActiveAccount } = await import('../../src/lib/api/client');

interface Call {
  url: string;
  body: Record<string, unknown>;
  authorization: string | undefined;
}

function stubServer(answer: (call: Call) => Response): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    const call: Call = {
      url,
      body: JSON.parse(String(init.body)) as Record<string, unknown>,
      authorization: (init.headers as Record<string, string>).Authorization,
    };
    calls.push(call);
    return answer(call);
  });
  return calls;
}

const json = (status: number, data: unknown) =>
  new Response(JSON.stringify({ data }), { status, headers: { 'Content-Type': 'application/json' } });

describe('signing out of an account that is not the active one', () => {
  let other: { id: string; serverUrl: string };

  beforeEach(() => {
    localStorage.clear();
    other = accounts.saveSignIn({
      serverUrl: 'https://other.example.com',
      username: 'bo',
      role: 'member',
      refreshToken: 'other-refresh-1',
    });
    const active = accounts.saveSignIn({
      serverUrl: 'https://active.example.com',
      username: 'ada',
      role: 'owner',
      refreshToken: 'active-refresh',
    });
    setActiveAccount(active);
  });

  it('ends that session on its own server with a token obtained for it', async () => {
    const calls = stubServer((call) =>
      call.url.endsWith('/auth/refresh')
        ? json(200, { accessToken: 'other-access', refreshToken: 'other-refresh-2' })
        : json(200, { message: 'ok' }),
    );

    await revokeAccountSession(other);

    expect(calls.map((c) => c.url)).toEqual([
      'https://other.example.com/api/v1/auth/refresh',
      'https://other.example.com/api/v1/auth/logout',
    ]);
    expect(calls[0]!.body).toEqual({ refreshToken: 'other-refresh-1' });
    // The rotated token is the one revoked, with the other account's own access token
    expect(calls[1]!.body).toEqual({ refreshToken: 'other-refresh-2' });
    expect(calls[1]!.authorization).toBe('Bearer other-access');
    // The active account is untouched
    expect(accounts.refreshToken(accounts.activeId()!)).toBe('active-refresh');
  });

  it('does not call logout when the server already ended the session', async () => {
    const calls = stubServer(() => json(401, { message: 'expired' }));
    await revokeAccountSession(other);
    expect(calls).toHaveLength(1);
  });

  it('reports an unreachable server so the caller can still drop the token', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('offline');
    });
    await expect(revokeAccountSession(other)).rejects.toThrow();
    accounts.markSignedOut(other.id);
    expect(accounts.refreshToken(other.id)).toBeNull();
    expect(accounts.byId(other.id)?.signedIn).toBe(false);
  });
});
