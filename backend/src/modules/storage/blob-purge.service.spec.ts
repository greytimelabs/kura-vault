import { BlobPurgeService } from './blob-purge.service';

/** A stand-in for the table: SELECT, DELETE and UPDATE as the service issues them. */
function makeService(keys: string[], failing: Set<string> = new Set()) {
  const pending = new Map(keys.map((key) => [key, 0]));
  const dataSource = {
    query: jest.fn(async (sql: string, params: unknown[]) => {
      if (sql.startsWith('SELECT')) {
        const skip = new Set(params[0] as string[]);
        return [...pending.keys()].filter((key) => !skip.has(key)).slice(0, params[1] as number).map((s3_key) => ({ s3_key }));
      }
      for (const key of params[0] as string[]) {
        if (sql.startsWith('DELETE')) pending.delete(key);
        else pending.set(key, pending.get(key)! + 1);
      }
      return [];
    }),
  };
  const storageService = {
    deleteObject: jest.fn(async (key: string) => {
      if (failing.has(key)) throw new Error('storage unreachable');
    }),
  };
  const service = new BlobPurgeService(dataSource as any, storageService as any);
  return { service, pending, storageService };
}

describe('BlobPurgeService.purge', () => {
  it('erases every queued file and forgets it', async () => {
    const keys = Array.from({ length: 1203 }, (_, i) => `v/m${i}/thumb.enc`);
    const { service, pending, storageService } = makeService(keys);
    await service.purge();
    expect(storageService.deleteObject).toHaveBeenCalledTimes(1203);
    expect(pending.size).toBe(0);
  });

  it('keeps a file that could not be erased, counts the attempt, and erases it next time', async () => {
    const failing = new Set(['v/m1/original.enc']);
    const { service, pending } = makeService(['v/m1/thumb.enc', 'v/m1/preview.enc', 'v/m1/original.enc'], failing);

    await service.purge();
    expect([...pending]).toEqual([['v/m1/original.enc', 1]]);

    failing.clear();
    await service.purge();
    expect(pending.size).toBe(0);
  });

  it('shares one run between overlapping calls', async () => {
    const { service, storageService } = makeService(['a', 'b']);
    await Promise.all([service.purge(), service.purge()]);
    expect(storageService.deleteObject).toHaveBeenCalledTimes(2);
  });
});
