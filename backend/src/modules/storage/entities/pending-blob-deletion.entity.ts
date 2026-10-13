import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

/** One encrypted file that is to be erased from storage. The row goes once the file is gone. */
@Entity('pending_blob_deletions')
export class PendingBlobDeletion {
  @PrimaryColumn({ name: 's3_key', type: 'text' })
  s3Key: string;

  @Column({ type: 'int', default: 0 })
  attempts: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
