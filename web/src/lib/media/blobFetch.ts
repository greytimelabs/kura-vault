/** The pre-signed link is no longer valid (they live for 60 seconds). Ask the API for a new one. */
export class ExpiredUrlError extends Error {
  constructor() {
    super('Download link expired');
    this.name = 'ExpiredUrlError';
  }
}

export class TooLargeError extends Error {
  constructor() {
    super('This file is too large to open in the browser');
    this.name = 'TooLargeError';
  }
}

/**
 * Fetch an encrypted blob straight from storage. No cookies, no referrer: the
 * storage host learns nothing beyond the signed URL it was given.
 */
export async function fetchEncrypted(url: string, opts: { signal?: AbortSignal; maxBytes?: number } = {}): Promise<ArrayBuffer> {
  const response = await fetch(url, {
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    cache: 'no-store',
    signal: opts.signal,
  });
  if (response.status === 403 || response.status === 400 || response.status === 401) {
    throw new ExpiredUrlError();
  }
  if (!response.ok) {
    throw new Error(`Storage responded ${response.status}`);
  }
  const length = Number(response.headers.get('Content-Length'));
  if (opts.maxBytes && Number.isFinite(length) && length > opts.maxBytes) {
    await response.body?.cancel();
    throw new TooLargeError();
  }
  return response.arrayBuffer();
}

/** Run async jobs with a fixed number in flight at once. */
export class TaskQueue {
  private active = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(private readonly concurrency: number) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.concurrency) {
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }
    this.active++;
    try {
      return await task();
    } finally {
      this.active--;
      this.waiting.shift()?.();
    }
  }
}
