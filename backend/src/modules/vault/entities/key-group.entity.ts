import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('key_groups')
export class KeyGroup {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * Unique Argon2id salt for this vault.
   * Not secret - sent to clients for KEK derivation.
   * Base64-encoded.
   */
  @Column({ name: 'kek_salt', type: 'text' })
  kekSalt: string;

  /**
   * A known string (vault UUID) encrypted with this vault's KEK.
   * Used to verify correct passphrase without storing passphrase.
   * Client decrypts this to confirm passphrase match.
   */
  @Column({ name: 'kek_verify', type: 'text' })
  kekVerify: string;

  /**
   * Nonce used for the kek_verify encryption.
   */
  @Column({ name: 'kek_verify_nonce', type: 'text' })
  kekVerifyNonce: string;

  /**
   * Encrypted vault label (e.g., "Family", "Friends").
   * Encrypted with this vault's KEK so server can't see vault names.
   */
  @Column({ name: 'label_encrypted', type: 'text', nullable: true })
  labelEncrypted: string | null;

  @Column({ name: 'label_nonce', type: 'text', nullable: true })
  labelNonce: string | null;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
