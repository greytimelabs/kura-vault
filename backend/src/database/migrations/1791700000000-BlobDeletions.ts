import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Encrypted files waiting to be erased from storage. A delete writes the keys
 * here in the same transaction that removes the rows, so a file is never left
 * behind because storage was unreachable at that moment.
 */
export class BlobDeletions1791700000000 implements MigrationInterface {
    name = 'BlobDeletions1791700000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "pending_blob_deletions" ("s3_key" text NOT NULL, "attempts" integer NOT NULL DEFAULT '0', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "pk_pending_blob_deletions" PRIMARY KEY ("s3_key"))`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE "pending_blob_deletions"`);
    }

}
