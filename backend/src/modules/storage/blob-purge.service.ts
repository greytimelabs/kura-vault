import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { StorageService } from './storage.service';
import { BLOB_PURGE_BATCH, BLOB_PURGE_CONCURRENCY, BLOB_PURGE_INTERVAL_MS } from '../../common/constants';

const TIERS = 'ARRAY[m.s3_key_thumb, m.s3_key_preview, m.s3_key_original]';

/**
 * Erases the encrypted files of deleted items from storage.
 *
 * Deleting is two steps that cannot be one: rows in the database, files in
 * storage. The `queue…` methods run inside the caller's transaction and record
 * which files must go; `purge` erases them afterwards and is tried again at
 * startup and on a timer, so a file outlives its row only until storage answers.
 */
@Injectable()
export class BlobPurgeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BlobPurgeService.name);
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly storageService: StorageService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.purge(), BLOB_PURGE_INTERVAL_MS);
    this.timer.unref();
    void this.purge();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Inside a transaction: mark the files of these items for erasing. */
  async queueMedia(manager: EntityManager, mediaIds: string[]): Promise<void> {
    await manager.query(
      `INSERT INTO pending_blob_deletions (s3_key)
       SELECT unnest(${TIERS}) FROM media m WHERE m.id = ANY($1::uuid[])
       ON CONFLICT DO NOTHING`,
      [mediaIds],
    );
  }

  /** Inside a transaction: mark every file of these vaults for erasing. */
  async queueVaults(manager: EntityManager, vaultIds: string[]): Promise<void> {
    await manager.query(
      `INSERT INTO pending_blob_deletions (s3_key)
       SELECT unnest(${TIERS}) FROM media m WHERE m.vault_id = ANY($1::uuid[])
       ON CONFLICT DO NOTHING`,
      [vaultIds],
    );
  }

  /** Erase what is queued. Safe to call at any time; overlapping calls share one run. */
  purge(): Promise<void> {
    this.running ??= this.run()
      .catch((err) => this.logger.error('Erasing deleted files failed', err))
      .finally(() => {
        this.running = null;
      });
    return this.running;
  }

  private async run(): Promise<void> {
    // Keys that failed in this run are left for the next one
    const failed = new Set<string>();
    for (;;) {
      const rows: { s3_key: string }[] = await this.dataSource.query(
        `SELECT s3_key FROM pending_blob_deletions WHERE NOT (s3_key = ANY($1::text[]))
         ORDER BY created_at LIMIT $2`,
        [[...failed], BLOB_PURGE_BATCH],
      );
      if (rows.length === 0) break;

      const erased: string[] = [];
      const queue = rows.map((row) => row.s3_key);
      await Promise.all(
        Array.from({ length: BLOB_PURGE_CONCURRENCY }, async () => {
          for (let key = queue.pop(); key !== undefined; key = queue.pop()) {
            try {
              await this.storageService.deleteObject(key);
              erased.push(key);
            } catch {
              failed.add(key);
            }
          }
        }),
      );

      if (erased.length > 0) {
        await this.dataSource.query(`DELETE FROM pending_blob_deletions WHERE s3_key = ANY($1::text[])`, [erased]);
      }
    }

    if (failed.size > 0) {
      await this.dataSource.query(
        `UPDATE pending_blob_deletions SET attempts = attempts + 1 WHERE s3_key = ANY($1::text[])`,
        [[...failed]],
      );
      this.logger.warn(`${failed.size} deleted files could not be erased from storage yet; will retry`);
    }
  }
}
