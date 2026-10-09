import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { KeyGroup } from './key-group.entity';

@Entity('invite_codes')
export class InviteCode {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * SHA-256 hash of the invite code.
   * Never store plaintext invite codes.
   */
  @Column({ name: 'code_hash', type: 'varchar', length: 128, unique: true })
  codeHash: string;

  @Column({ name: 'key_group_id', type: 'uuid' })
  keyGroupId: string;

  @ManyToOne(() => KeyGroup, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'key_group_id' })
  keyGroup: KeyGroup;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @Column({ name: 'is_used', type: 'boolean', default: false })
  isUsed: boolean;

  @Column({ name: 'used_by_user_id', type: 'uuid', nullable: true })
  usedByUserId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
