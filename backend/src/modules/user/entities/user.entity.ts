import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';
import { AccessLevel, UserRole, UserStatus } from '../../../common/types';

@Entity('users')
@Index('uq_users_single_owner', ['role'], { unique: true, where: "role = 'owner'" })
export class User {
  /**
   * Generated before the account exists (by the owner's client at setup, by the
   * server for an invite) because the user's key material is bound to it.
   */
  @PrimaryColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 32, unique: true })
  username: string;

  /**
   * bcrypt hash of the sign-in password. The password only opens the API; it is
   * not the master passphrase and decrypts nothing.
   */
  @Column({ name: 'password_hash', type: 'text' })
  passwordHash: string;

  @Column({ type: 'enum', enum: UserRole, default: UserRole.MEMBER })
  role: UserRole;

  @Column({ name: 'access_level', type: 'enum', enum: AccessLevel, default: AccessLevel.LIMITED })
  accessLevel: AccessLevel;

  @Column({ type: 'enum', enum: UserStatus, default: UserStatus.ACTIVE })
  status: UserStatus;

  /** Argon2id salt for the master passphrase. Not secret. */
  @Column({ name: 'kdf_salt', type: 'text' })
  kdfSalt: string;

  /** The user's private keys, encrypted on their device under the master passphrase. */
  @Column({ name: 'encrypted_private_keys', type: 'text' })
  encryptedPrivateKeys: string;

  @Column({ name: 'private_keys_nonce', type: 'text' })
  privateKeysNonce: string;

  /** X25519. Vault and album keys are sealed to it. */
  @Column({ name: 'public_enc_key', type: 'text' })
  publicEncKey: string;

  /** Ed25519. Verifies what this user shares. */
  @Column({ name: 'public_sign_key', type: 'text' })
  publicSignKey: string;

  /**
   * The owner's signature over this user's id, username and public keys. Null
   * until the owner's client has verified the keys; nothing can be shared with
   * the user before that.
   */
  @Column({ name: 'key_cert', type: 'text', nullable: true })
  keyCert: string | null;

  @Column({ name: 'last_login_at', type: 'timestamptz', nullable: true })
  lastLoginAt: Date | null;

  @Column({ name: 'failed_login_attempts', type: 'int', default: 0 })
  failedLoginAttempts: number;

  @Column({ name: 'locked_until', type: 'timestamptz', nullable: true })
  lockedUntil: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
