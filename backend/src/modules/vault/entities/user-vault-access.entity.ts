import { Entity, Column, PrimaryColumn, ManyToOne, JoinColumn, CreateDateColumn } from 'typeorm';
import { User } from '../../user/entities/user.entity';
import { KeyGroup } from './key-group.entity';
import { VaultPermission } from '../../../common/types';

@Entity('user_vault_access')
export class UserVaultAccess {
  @PrimaryColumn({ name: 'user_id', type: 'uuid' })
  userId: string;

  @PrimaryColumn({ name: 'key_group_id', type: 'uuid' })
  keyGroupId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @ManyToOne(() => KeyGroup, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'key_group_id' })
  keyGroup: KeyGroup;

  @Column({ type: 'enum', enum: VaultPermission, default: VaultPermission.VIEW })
  permission: VaultPermission;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
