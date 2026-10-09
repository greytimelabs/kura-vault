import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Accounts with a keypair each, vaults and albums shared by wrapping their keys
 * per user. Replaces the earlier passphrase-only schema outright: data written
 * by older builds is not migrated.
 */
export class InitialSchema1791600000000 implements MigrationInterface {
    name = 'InitialSchema1791600000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."users_role_enum" AS ENUM('owner', 'member')`);
        await queryRunner.query(`CREATE TYPE "public"."users_access_level_enum" AS ENUM('full', 'limited')`);
        await queryRunner.query(`CREATE TYPE "public"."users_status_enum" AS ENUM('active', 'restricted')`);
        await queryRunner.query(`CREATE TABLE "users" ("id" uuid NOT NULL, "username" character varying(32) NOT NULL, "password_hash" text NOT NULL, "role" "public"."users_role_enum" NOT NULL DEFAULT 'member', "access_level" "public"."users_access_level_enum" NOT NULL DEFAULT 'limited', "status" "public"."users_status_enum" NOT NULL DEFAULT 'active', "kdf_salt" text NOT NULL, "encrypted_private_keys" text NOT NULL, "private_keys_nonce" text NOT NULL, "public_enc_key" text NOT NULL, "public_sign_key" text NOT NULL, "key_cert" text, "last_login_at" TIMESTAMP WITH TIME ZONE, "failed_login_attempts" integer NOT NULL DEFAULT '0', "locked_until" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "uq_users_username" UNIQUE ("username"), CONSTRAINT "pk_users" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "uq_users_single_owner" ON "users" ("role") WHERE role = 'owner'`);

        await queryRunner.query(`CREATE TABLE "refresh_tokens" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "token_hash" character varying(128) NOT NULL, "user_id" uuid NOT NULL, "username" character varying(255) NOT NULL, "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "is_revoked" boolean NOT NULL DEFAULT false, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "uq_refresh_tokens_hash" UNIQUE ("token_hash"), CONSTRAINT "pk_refresh_tokens" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "idx_refresh_tokens_user" ON "refresh_tokens" ("user_id")`);

        await queryRunner.query(`CREATE TABLE "user_invites" ("id" uuid NOT NULL, "user_id" uuid NOT NULL, "username" character varying(32) NOT NULL, "access_level" "public"."users_access_level_enum" NOT NULL DEFAULT 'limited', "token_hash" character varying(64) NOT NULL, "owner_secret_encrypted" text NOT NULL, "key_binding" text, "created_by" uuid NOT NULL, "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "used_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "uq_user_invites_user" UNIQUE ("user_id"), CONSTRAINT "uq_user_invites_username" UNIQUE ("username"), CONSTRAINT "pk_user_invites" PRIMARY KEY ("id"))`);

        await queryRunner.query(`CREATE TABLE "vaults" ("id" uuid NOT NULL, "created_by" uuid NOT NULL, "label_encrypted" text, "label_nonce" text, "sort_order" integer NOT NULL DEFAULT '0', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "pk_vaults" PRIMARY KEY ("id"))`);

        await queryRunner.query(`CREATE TYPE "public"."vault_members_role_enum" AS ENUM('creator', 'member')`);
        await queryRunner.query(`CREATE TYPE "public"."share_permission_enum" AS ENUM('view', 'write')`);
        await queryRunner.query(`CREATE TABLE "vault_members" ("vault_id" uuid NOT NULL, "user_id" uuid NOT NULL, "role" "public"."vault_members_role_enum" NOT NULL, "permission" "public"."share_permission_enum" NOT NULL DEFAULT 'view', "wrapped_key" text NOT NULL, "kdf_salt" text, "granted_by" uuid, "grant_sig" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "chk_vault_members_role" CHECK ((role = 'creator' AND kdf_salt IS NOT NULL AND granted_by IS NULL AND grant_sig IS NULL) OR (role = 'member' AND kdf_salt IS NULL AND granted_by IS NOT NULL AND grant_sig IS NOT NULL)), CONSTRAINT "pk_vault_members" PRIMARY KEY ("vault_id", "user_id"))`);
        await queryRunner.query(`CREATE INDEX "idx_vault_members_user" ON "vault_members" ("user_id")`);
        await queryRunner.query(`CREATE UNIQUE INDEX "uq_vault_members_creator" ON "vault_members" ("vault_id") WHERE role = 'creator'`);

        await queryRunner.query(`CREATE TYPE "public"."albums_kind_enum" AS ENUM('regular', 'liked')`);
        await queryRunner.query(`CREATE TABLE "albums" ("id" uuid NOT NULL, "vault_id" uuid NOT NULL, "kind" "public"."albums_kind_enum" NOT NULL DEFAULT 'regular', "owner_user_id" uuid, "name_encrypted" text, "name_nonce" text, "key_wrapped" text, "key_nonce" text, "cover_media_id" uuid, "sort_order" integer NOT NULL DEFAULT '0', "media_count" integer NOT NULL DEFAULT '0', "created_by" uuid, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "chk_albums_kind" CHECK ((kind = 'regular' AND name_encrypted IS NOT NULL AND name_nonce IS NOT NULL AND key_wrapped IS NOT NULL AND key_nonce IS NOT NULL) OR (kind = 'liked' AND owner_user_id IS NOT NULL)), CONSTRAINT "pk_albums" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "idx_albums_vault" ON "albums" ("vault_id")`);
        await queryRunner.query(`CREATE UNIQUE INDEX "uq_albums_liked_owner_vault" ON "albums" ("owner_user_id", "vault_id") WHERE kind = 'liked'`);

        await queryRunner.query(`CREATE TABLE "album_members" ("album_id" uuid NOT NULL, "user_id" uuid NOT NULL, "permission" "public"."share_permission_enum" NOT NULL DEFAULT 'view', "wrapped_key" text NOT NULL, "granted_by" uuid NOT NULL, "grant_sig" text NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "pk_album_members" PRIMARY KEY ("album_id", "user_id"))`);
        await queryRunner.query(`CREATE INDEX "idx_album_members_user" ON "album_members" ("user_id")`);

        await queryRunner.query(`CREATE TYPE "public"."media_media_type_enum" AS ENUM('photo', 'video')`);
        await queryRunner.query(`CREATE TABLE "media" ("id" uuid NOT NULL, "vault_id" uuid NOT NULL, "uploaded_by" uuid, "captured_at" TIMESTAMP WITH TIME ZONE, "media_type" "public"."media_media_type_enum" NOT NULL, "file_size_bytes" bigint, "width" integer, "height" integer, "duration_seconds" integer, "aspect_ratio" double precision, "year_month" character varying(7), "s3_key_thumb" text NOT NULL, "s3_key_preview" text NOT NULL, "s3_key_original" text NOT NULL, "thumb_iv" text NOT NULL, "preview_iv" text NOT NULL, "original_iv" text NOT NULL, "key_wrapped_vault" text, "key_nonce_vault" text, "encrypted_meta" text, "meta_nonce" text, "is_deleted" boolean NOT NULL DEFAULT false, "deleted_at" TIMESTAMP WITH TIME ZONE, "uploaded_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "pk_media" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "idx_media_vault_captured" ON "media" ("vault_id", "captured_at")`);
        await queryRunner.query(`CREATE INDEX "idx_media_yearmonth" ON "media" ("year_month")`);

        await queryRunner.query(`CREATE TABLE "album_media" ("album_id" uuid NOT NULL, "media_id" uuid NOT NULL, "key_wrapped" text, "key_nonce" text, "sort_order" integer NOT NULL DEFAULT '0', "added_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "pk_album_media" PRIMARY KEY ("album_id", "media_id"))`);
        await queryRunner.query(`CREATE INDEX "idx_album_media_media" ON "album_media" ("media_id")`);
        await queryRunner.query(`CREATE INDEX "idx_album_media_album" ON "album_media" ("album_id")`);

        await queryRunner.query(`ALTER TABLE "refresh_tokens" ADD CONSTRAINT "fk_refresh_tokens_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "user_invites" ADD CONSTRAINT "fk_user_invites_creator" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "vaults" ADD CONSTRAINT "fk_vaults_creator" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "vault_members" ADD CONSTRAINT "fk_vault_members_vault" FOREIGN KEY ("vault_id") REFERENCES "vaults"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "vault_members" ADD CONSTRAINT "fk_vault_members_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "vault_members" ADD CONSTRAINT "fk_vault_members_granter" FOREIGN KEY ("granted_by") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "albums" ADD CONSTRAINT "fk_albums_vault" FOREIGN KEY ("vault_id") REFERENCES "vaults"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "albums" ADD CONSTRAINT "fk_albums_owner" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "albums" ADD CONSTRAINT "fk_albums_creator" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "album_members" ADD CONSTRAINT "fk_album_members_album" FOREIGN KEY ("album_id") REFERENCES "albums"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "album_members" ADD CONSTRAINT "fk_album_members_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "album_members" ADD CONSTRAINT "fk_album_members_granter" FOREIGN KEY ("granted_by") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "media" ADD CONSTRAINT "fk_media_vault" FOREIGN KEY ("vault_id") REFERENCES "vaults"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "media" ADD CONSTRAINT "fk_media_uploader" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "album_media" ADD CONSTRAINT "fk_album_media_album" FOREIGN KEY ("album_id") REFERENCES "albums"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "album_media" ADD CONSTRAINT "fk_album_media_media" FOREIGN KEY ("media_id") REFERENCES "media"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE "album_media"`);
        await queryRunner.query(`DROP TABLE "media"`);
        await queryRunner.query(`DROP TYPE "public"."media_media_type_enum"`);
        await queryRunner.query(`DROP TABLE "album_members"`);
        await queryRunner.query(`DROP TABLE "albums"`);
        await queryRunner.query(`DROP TYPE "public"."albums_kind_enum"`);
        await queryRunner.query(`DROP TABLE "vault_members"`);
        await queryRunner.query(`DROP TYPE "public"."share_permission_enum"`);
        await queryRunner.query(`DROP TYPE "public"."vault_members_role_enum"`);
        await queryRunner.query(`DROP TABLE "vaults"`);
        await queryRunner.query(`DROP TABLE "user_invites"`);
        await queryRunner.query(`DROP TABLE "refresh_tokens"`);
        await queryRunner.query(`DROP TABLE "users"`);
        await queryRunner.query(`DROP TYPE "public"."users_status_enum"`);
        await queryRunner.query(`DROP TYPE "public"."users_access_level_enum"`);
        await queryRunner.query(`DROP TYPE "public"."users_role_enum"`);
    }

}
