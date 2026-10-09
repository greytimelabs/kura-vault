import { Entity, Column, PrimaryColumn, ManyToOne, JoinColumn, CreateDateColumn, Index, Check } from 'typeorm';
import { User } from '../../user/entities/user.entity';
import { Vault } from './vault.entity';
import { SharePermission, VaultMemberRole } from '../../../common/types';

/**
 * Who can open a vault, and their own wrapped copy of its key. Deleting a row
 * removes both the access and the key from the database.
 */
@Entity('vault_members')
@Index('idx_vault_members_user', ['userId'])
@Index('uq_vault_members_creator', ['vaultId'], { unique: true, where: "role = 'creator'" })
@Check(
  'chk_vault_members_role',
  "(role = 'creator' AND kdf_salt IS NOT NULL AND granted_by IS NULL AND grant_sig IS NULL) OR " +
    "(role = 'member' AND kdf_salt IS NULL AND granted_by IS NOT NULL AND grant_sig IS NOT NULL)",
)
export class VaultMember {
  @PrimaryColumn({ name: 'vault_id', type: 'uuid' })
  vaultId: string;

  @PrimaryColumn({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => Vault, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'vault_id' })
  vault: Vault;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'enum', enum: VaultMemberRole })
  role: VaultMemberRole;

  @Column({ type: 'enum', enum: SharePermission, enumName: 'share_permission_enum', default: SharePermission.VIEW })
  permission: SharePermission;

  /**
   * The vault key sealed to this user's public key. For the creator the sealed
   * content is itself encrypted under the vault passphrase.
   */
  @Column({ name: 'wrapped_key', type: 'text' })
  wrappedKey: string;

  /** Creator only: Argon2id salt for the vault passphrase. */
  @Column({ name: 'kdf_salt', type: 'text', nullable: true })
  kdfSalt: string | null;

  /** Member only: who shared the vault. */
  @Column({ name: 'granted_by', type: 'uuid', nullable: true })
  grantedBy: string | null;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'granted_by' })
  granter: User | null;

  /** Member only: the sharer's signature over the sealed key, checked by the recipient before use. */
  @Column({ name: 'grant_sig', type: 'text', nullable: true })
  grantSig: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
