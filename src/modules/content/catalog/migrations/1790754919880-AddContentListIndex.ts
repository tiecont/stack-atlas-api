import type { PoolClient } from 'pg';
import type { MigrationInterface } from '../../../../database/migrations/migration.interface';

export class AddContentListIndex1790754919880 implements MigrationInterface {
  async up(queryRunner: PoolClient): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX content_items_created_id_desc_idx
        ON stack_atlas.content_items (created_at DESC, id DESC);
    `);
  }

  async down(queryRunner: PoolClient): Promise<void> {
    await queryRunner.query(`
      DROP INDEX stack_atlas.content_items_created_id_desc_idx;
    `);
  }
}
