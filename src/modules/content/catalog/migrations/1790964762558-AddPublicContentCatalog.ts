import type { PoolClient } from 'pg';
import type { MigrationInterface } from '../../../../database/migrations/migration.interface';

export class AddPublicContentCatalog1790964762558 implements MigrationInterface {
  async up(queryRunner: PoolClient): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE stack_atlas.content_catalog_snapshots (
        id uuid PRIMARY KEY,
        source_repository text NOT NULL
          CHECK (source_repository = 'tiecont/stack-atlas'),
        source_commit_sha text NOT NULL UNIQUE
          CHECK (source_commit_sha ~ '^[a-f0-9]{40}$'),
        checksum_sha256 text NOT NULL
          CHECK (checksum_sha256 ~ '^[a-f0-9]{64}$'),
        catalog jsonb NOT NULL
          CHECK (
            jsonb_typeof(catalog) = 'object'
            AND catalog->>'schema_version' = '1'
            AND jsonb_typeof(catalog->'articles') = 'array'
          ),
        created_by uuid NOT NULL
          REFERENCES stack_atlas.users(id) ON DELETE RESTRICT,
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE stack_atlas.content_catalog_active_snapshot (
        slot smallint PRIMARY KEY DEFAULT 1 CHECK (slot = 1),
        snapshot_id uuid NOT NULL
          REFERENCES stack_atlas.content_catalog_snapshots(id) ON DELETE RESTRICT,
        updated_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE FUNCTION stack_atlas.prevent_content_catalog_snapshot_mutation()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $function$
      BEGIN
        RAISE EXCEPTION 'content catalog snapshots are immutable'
          USING ERRCODE = '55000';
      END;
      $function$;

      CREATE TRIGGER content_catalog_snapshots_immutable
        BEFORE UPDATE OR DELETE ON stack_atlas.content_catalog_snapshots
        FOR EACH ROW EXECUTE FUNCTION stack_atlas.prevent_content_catalog_snapshot_mutation();
    `);
  }

  async down(queryRunner: PoolClient): Promise<void> {
    await queryRunner.query(`
      DO $migration$
      BEGIN
        IF EXISTS (SELECT 1 FROM stack_atlas.content_catalog_snapshots) THEN
          RAISE EXCEPTION 'Refusing to roll back imported public catalog snapshots';
        END IF;
      END
      $migration$;

      DROP TABLE stack_atlas.content_catalog_active_snapshot;
      DROP TABLE stack_atlas.content_catalog_snapshots;
      DROP FUNCTION stack_atlas.prevent_content_catalog_snapshot_mutation();
    `);
  }
}
