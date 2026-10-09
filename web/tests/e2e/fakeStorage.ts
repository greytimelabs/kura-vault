import type { BrowserContext, Route } from '@playwright/test';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, PUT',
  'access-control-allow-headers': 'content-type',
  'access-control-expose-headers': 'ETag',
};

/**
 * In-memory stand-in for the S3 bucket. The browser's own requests to the storage
 * host are answered from here, so uploads and downloads run through the real
 * client code, encryption included, without a real bucket.
 */
export class FakeStorage {
  private readonly objects = new Map<string, Buffer>();
  /** Links signed before this moment answer 403, as an expired link does. */
  private expireSignedBefore = 0;

  async attach(context: BrowserContext): Promise<void> {
    await context.route(/^https:\/\/[^/]*amazonaws\.com\//, (route) => this.handle(route));
  }

  /** Every link issued so far stops working; links issued from now on are fine. */
  expireExistingLinks(): void {
    this.expireSignedBefore = Date.now();
  }

  /** When a pre-signed URL was signed, from its X-Amz-Date (e.g. 20261008T170102Z). */
  private static signedAt(url: URL): number {
    const stamp = url.searchParams.get('X-Amz-Date') ?? '';
    const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(stamp);
    if (!match) return 0;
    const [, y, mo, d, h, mi, sec] = match.map(Number);
    return Date.UTC(y!, mo! - 1, d!, h!, mi!, sec!);
  }

  keys(): string[] {
    return [...this.objects.keys()];
  }

  get(key: string): Buffer | undefined {
    return this.objects.get(key);
  }

  private async handle(route: Route): Promise<void> {
    const request = route.request();
    const url = new URL(request.url());
    const key = url.pathname;

    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: CORS });
      return;
    }

    if (request.method() === 'PUT') {
      if (request.headers()['content-type'] !== 'application/octet-stream') {
        await route.fulfill({ status: 403, headers: CORS, body: 'SignatureDoesNotMatch' });
        return;
      }
      this.objects.set(key, request.postDataBuffer() ?? Buffer.alloc(0));
      await route.fulfill({ status: 200, headers: { ...CORS, etag: '"e2e"' } });
      return;
    }

    if (request.method() === 'GET') {
      // Signing times have one-second resolution, so compare whole seconds
      if (FakeStorage.signedAt(url) < Math.floor(this.expireSignedBefore / 1000) * 1000) {
        await route.fulfill({ status: 403, headers: CORS, body: 'Request has expired' });
        return;
      }
      const body = this.objects.get(key);
      if (!body) {
        await route.fulfill({ status: 404, headers: CORS, body: 'NoSuchKey' });
        return;
      }
      await route.fulfill({
        status: 200,
        headers: { ...CORS, 'content-type': 'application/octet-stream' },
        body,
      });
      return;
    }

    await route.fulfill({ status: 405, headers: CORS });
  }
}
