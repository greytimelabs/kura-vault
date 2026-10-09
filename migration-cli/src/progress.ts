import Database from 'better-sqlite3';
import * as path from 'path';
import { FileStatus } from './types';

/**
 * SQLite-based progress tracker for resumable uploads.
 */
export class ProgressTracker {
  private db: Database.Database;

  constructor(sourceDir: string) {
    const dbPath = path.join(sourceDir, '.kuravault-migration.db');
    this.db = new Database(dbPath);
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS files (
        path TEXT PRIMARY KEY,
        media_id TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        error TEXT,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
  }

  /**
   * Register a file if not already tracked.
   */
  addFile(filePath: string): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO files (path, status, updated_at) VALUES (?, 'pending', datetime('now'))`,
      )
      .run(filePath);
  }

  /**
   * Get the status of a file.
   */
  getStatus(filePath: string): FileStatus | null {
    const row = this.db
      .prepare('SELECT status FROM files WHERE path = ?')
      .get(filePath) as { status: FileStatus } | undefined;
    return row?.status || null;
  }

  /**
   * Update file status.
   */
  updateStatus(filePath: string, status: FileStatus, mediaId?: string, error?: string): void {
    this.db
      .prepare(
        `UPDATE files SET status = ?, media_id = COALESCE(?, media_id), error = ?, updated_at = datetime('now') WHERE path = ?`,
      )
      .run(status, mediaId || null, error || null, filePath);
  }

  /**
   * Get all files that are not 'done'.
   */
  getPendingFiles(): string[] {
    const rows = this.db
      .prepare("SELECT path FROM files WHERE status != 'done' ORDER BY path")
      .all() as { path: string }[];
    return rows.map((r) => r.path);
  }

  /**
   * Get summary counts.
   */
  getSummary(): Record<FileStatus, number> {
    const rows = this.db
      .prepare('SELECT status, COUNT(*) as count FROM files GROUP BY status')
      .all() as { status: FileStatus; count: number }[];

    const summary: Record<string, number> = {
      pending: 0,
      processing: 0,
      uploading: 0,
      completing: 0,
      done: 0,
      failed: 0,
    };
    for (const row of rows) {
      summary[row.status] = row.count;
    }
    return summary as Record<FileStatus, number>;
  }

  close(): void {
    this.db.close();
  }
}
