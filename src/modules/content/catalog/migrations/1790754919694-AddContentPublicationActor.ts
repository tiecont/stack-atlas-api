import type { PoolClient } from 'pg';
import type { MigrationInterface } from '../../../../database/migrations/migration.interface';

export class AddContentPublicationActor1790754919694 implements MigrationInterface {
  async up(queryRunner: PoolClient): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE stack_atlas.content_publications
        ADD COLUMN published_by uuid
        REFERENCES stack_atlas.users(id) ON DELETE RESTRICT;
    `);
  }

  async down(queryRunner: PoolClient): Promise<void> {
    await queryRunner.query(`
      DO $migration$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM stack_atlas.content_publications
          WHERE published_by IS NOT NULL
        ) THEN
          RAISE EXCEPTION 'Refusing to remove recorded publication actor attribution'
            USING ERRCODE = '55000';
        END IF;
      END
      $migration$;

      ALTER TABLE stack_atlas.content_publications
        DROP COLUMN published_by;
    `);
  }
}
