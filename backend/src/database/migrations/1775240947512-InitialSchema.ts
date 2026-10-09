import { MigrationInterface, QueryRunner } from "typeorm";

export class InitialSchema1775240947512 implements MigrationInterface {
    name = 'InitialSchema1775240947512'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
        await queryRunner.query(`CREATE TYPE "public"."users_role_enum" AS ENUM('owner', 'viewer')`);
        await queryRunner.query(`CREATE TABLE "users" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying(100) NOT NULL, "device_id" character varying(255) NOT NULL, "password_hash" text NOT NULL, "role" "public"."users_role_enum" NOT NULL DEFAULT 'viewer', "is_active" boolean NOT NULL DEFAULT true, "last_login_at" TIMESTAMP WITH TIME ZONE, "failed_login_attempts" integer NOT NULL DEFAULT '0', "locked_until" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_69c064f0f99e36e4e44c702d673" UNIQUE ("device_id"), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "key_groups" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "kek_salt" text NOT NULL, "kek_verify" text NOT NULL, "kek_verify_nonce" text NOT NULL, "label_encrypted" text, "label_nonce" text, "sort_order" integer NOT NULL DEFAULT '0', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_b37269c43e5a4422281ff3c9111" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "public"."albums_kind_enum" AS ENUM('regular', 'liked')`);
        await queryRunner.query(`CREATE TABLE "albums" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "key_group_id" uuid NOT NULL, "kind" "public"."albums_kind_enum" NOT NULL DEFAULT 'regular', "owner_user_id" uuid, "name_encrypted" text, "name_nonce" text, "cover_media_id" uuid, "sort_order" integer NOT NULL DEFAULT '0', "media_count" integer NOT NULL DEFAULT '0', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "chk_albums_kind" CHECK ((kind = 'regular' AND name_encrypted IS NOT NULL AND name_nonce IS NOT NULL) OR (kind = 'liked' AND owner_user_id IS NOT NULL)), CONSTRAINT "PK_838ebae24d2e12082670ffc95d7" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "idx_albums_vault" ON "albums" ("key_group_id") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "uq_albums_liked_owner_vault" ON "albums" ("owner_user_id", "key_group_id") WHERE kind = 'liked'`);
        await queryRunner.query(`CREATE TYPE "public"."media_media_type_enum" AS ENUM('photo', 'video')`);
        await queryRunner.query(`CREATE TABLE "media" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "captured_at" TIMESTAMP WITH TIME ZONE, "media_type" "public"."media_media_type_enum" NOT NULL, "file_size_bytes" bigint, "width" integer, "height" integer, "duration_seconds" integer, "aspect_ratio" double precision, "year_month" character varying(7), "s3_key_thumb" text NOT NULL, "s3_key_preview" text NOT NULL, "s3_key_original" text NOT NULL, "thumb_iv" text NOT NULL, "preview_iv" text NOT NULL, "original_iv" text NOT NULL, "is_deleted" boolean NOT NULL DEFAULT false, "deleted_at" TIMESTAMP WITH TIME ZONE, "uploaded_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_f4e0fcac36e050de337b670d8bd" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "idx_media_yearmonth" ON "media" ("year_month") `);
        await queryRunner.query(`CREATE INDEX "idx_media_captured" ON "media" ("captured_at") `);
        await queryRunner.query(`CREATE TABLE "album_media" ("album_id" uuid NOT NULL, "media_id" uuid NOT NULL, "sort_order" integer NOT NULL DEFAULT '0', "added_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_842d66e69185315306d2e8b194b" PRIMARY KEY ("album_id", "media_id"))`);
        await queryRunner.query(`CREATE INDEX "idx_album_media_media" ON "album_media" ("media_id") `);
        await queryRunner.query(`CREATE INDEX "idx_album_media_album" ON "album_media" ("album_id") `);
        await queryRunner.query(`CREATE TABLE "refresh_tokens" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "token_hash" character varying(128) NOT NULL, "user_id" uuid NOT NULL, "device_id" character varying(255) NOT NULL, "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "is_revoked" boolean NOT NULL DEFAULT false, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_a7838d2ba25be1342091b6695f1" UNIQUE ("token_hash"), CONSTRAINT "PK_7d8bee0204106019488c4c50ffa" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "public"."user_vault_access_permission_enum" AS ENUM('admin', 'view')`);
        await queryRunner.query(`CREATE TABLE "user_vault_access" ("user_id" uuid NOT NULL, "key_group_id" uuid NOT NULL, "permission" "public"."user_vault_access_permission_enum" NOT NULL DEFAULT 'view', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_0bb342ba08e149c3e6c3952a752" PRIMARY KEY ("user_id", "key_group_id"))`);
        await queryRunner.query(`CREATE TABLE "media_vault_access" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "media_id" uuid NOT NULL, "key_group_id" uuid NOT NULL, "encrypted_dek" text NOT NULL, "dek_nonce" text NOT NULL, "encrypted_meta" text, "meta_nonce" text, CONSTRAINT "uq_media_vault" UNIQUE ("media_id", "key_group_id"), CONSTRAINT "PK_054ee22beb25582c8b0b460f5e8" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "idx_mva_media" ON "media_vault_access" ("media_id") `);
        await queryRunner.query(`CREATE INDEX "idx_mva_vault" ON "media_vault_access" ("key_group_id") `);
        await queryRunner.query(`CREATE TABLE "invite_codes" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "code_hash" character varying(128) NOT NULL, "key_group_id" uuid NOT NULL, "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "is_used" boolean NOT NULL DEFAULT false, "used_by_user_id" uuid, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_28e16c3f9e3e8d7cf8ac780e7f9" UNIQUE ("code_hash"), CONSTRAINT "PK_6c0ede25edb23ae63c935138e33" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "albums" ADD CONSTRAINT "FK_ffbffeb6f4466fc3799f14dad35" FOREIGN KEY ("key_group_id") REFERENCES "key_groups"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "albums" ADD CONSTRAINT "FK_0637f371ceb575dc9f235828b66" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "album_media" ADD CONSTRAINT "FK_846915f9ddbc3350c2ea28b1989" FOREIGN KEY ("album_id") REFERENCES "albums"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "album_media" ADD CONSTRAINT "FK_e846eea26bfbc6b3c3252a641a1" FOREIGN KEY ("media_id") REFERENCES "media"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "refresh_tokens" ADD CONSTRAINT "FK_3ddc983c5f7bcf132fd8732c3f4" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "user_vault_access" ADD CONSTRAINT "FK_4910d83415fcd0df7bd4f0cbb5d" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "user_vault_access" ADD CONSTRAINT "FK_a1e3cdaccb729fa2476a30fa9fa" FOREIGN KEY ("key_group_id") REFERENCES "key_groups"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "media_vault_access" ADD CONSTRAINT "FK_64d98a3c63875d3c957a062b3a7" FOREIGN KEY ("media_id") REFERENCES "media"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "media_vault_access" ADD CONSTRAINT "FK_50ca7a61b6b287ff989883006b8" FOREIGN KEY ("key_group_id") REFERENCES "key_groups"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "invite_codes" ADD CONSTRAINT "FK_a03d62d3b04f42adcd2d09d9e41" FOREIGN KEY ("key_group_id") REFERENCES "key_groups"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "invite_codes" DROP CONSTRAINT "FK_a03d62d3b04f42adcd2d09d9e41"`);
        await queryRunner.query(`ALTER TABLE "media_vault_access" DROP CONSTRAINT "FK_50ca7a61b6b287ff989883006b8"`);
        await queryRunner.query(`ALTER TABLE "media_vault_access" DROP CONSTRAINT "FK_64d98a3c63875d3c957a062b3a7"`);
        await queryRunner.query(`ALTER TABLE "user_vault_access" DROP CONSTRAINT "FK_a1e3cdaccb729fa2476a30fa9fa"`);
        await queryRunner.query(`ALTER TABLE "user_vault_access" DROP CONSTRAINT "FK_4910d83415fcd0df7bd4f0cbb5d"`);
        await queryRunner.query(`ALTER TABLE "refresh_tokens" DROP CONSTRAINT "FK_3ddc983c5f7bcf132fd8732c3f4"`);
        await queryRunner.query(`ALTER TABLE "album_media" DROP CONSTRAINT "FK_e846eea26bfbc6b3c3252a641a1"`);
        await queryRunner.query(`ALTER TABLE "album_media" DROP CONSTRAINT "FK_846915f9ddbc3350c2ea28b1989"`);
        await queryRunner.query(`ALTER TABLE "albums" DROP CONSTRAINT "FK_0637f371ceb575dc9f235828b66"`);
        await queryRunner.query(`ALTER TABLE "albums" DROP CONSTRAINT "FK_ffbffeb6f4466fc3799f14dad35"`);
        await queryRunner.query(`DROP TABLE "invite_codes"`);
        await queryRunner.query(`DROP INDEX "public"."idx_mva_vault"`);
        await queryRunner.query(`DROP INDEX "public"."idx_mva_media"`);
        await queryRunner.query(`DROP TABLE "media_vault_access"`);
        await queryRunner.query(`DROP TABLE "user_vault_access"`);
        await queryRunner.query(`DROP TYPE "public"."user_vault_access_permission_enum"`);
        await queryRunner.query(`DROP TABLE "refresh_tokens"`);
        await queryRunner.query(`DROP INDEX "public"."idx_album_media_album"`);
        await queryRunner.query(`DROP INDEX "public"."idx_album_media_media"`);
        await queryRunner.query(`DROP TABLE "album_media"`);
        await queryRunner.query(`DROP INDEX "public"."idx_media_captured"`);
        await queryRunner.query(`DROP INDEX "public"."idx_media_yearmonth"`);
        await queryRunner.query(`DROP TABLE "media"`);
        await queryRunner.query(`DROP TYPE "public"."media_media_type_enum"`);
        await queryRunner.query(`DROP INDEX "public"."uq_albums_liked_owner_vault"`);
        await queryRunner.query(`DROP INDEX "public"."idx_albums_vault"`);
        await queryRunner.query(`DROP TABLE "albums"`);
        await queryRunner.query(`DROP TYPE "public"."albums_kind_enum"`);
        await queryRunner.query(`DROP TABLE "key_groups"`);
        await queryRunner.query(`DROP TABLE "users"`);
        await queryRunner.query(`DROP TYPE "public"."users_role_enum"`);
    }

}
