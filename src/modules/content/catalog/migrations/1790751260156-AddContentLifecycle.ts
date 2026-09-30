import type { PoolClient } from 'pg';
import type { MigrationInterface } from '../../../../database/migrations/migration.interface';

export class AddContentLifecycle1790751260156 implements MigrationInterface {
  async up(queryRunner: PoolClient): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE stack_atlas.content_items
        ADD COLUMN slug text,
        ADD COLUMN status text NOT NULL DEFAULT 'DRAFT',
        ADD COLUMN created_by uuid REFERENCES stack_atlas.users(id) ON DELETE RESTRICT,
        ADD COLUMN archived_at timestamptz,
        ADD COLUMN archived_by uuid REFERENCES stack_atlas.users(id) ON DELETE RESTRICT;

      UPDATE stack_atlas.content_items
      SET slug = 'legacy-' || replace(id::text, '-', ''),
          status = CASE
            WHEN published_revision_id IS NULL THEN 'DRAFT'
            ELSE 'PUBLISHED'
          END;

      ALTER TABLE stack_atlas.content_items
        ALTER COLUMN slug SET NOT NULL,
        ADD CONSTRAINT content_items_status_check
          CHECK (status IN ('DRAFT', 'IN_REVIEW', 'PUBLISHED', 'ARCHIVED')),
        ADD CONSTRAINT content_items_slug_check
          CHECK (
            length(slug) BETWEEN 1 AND 255
            AND slug ~ '^[a-z0-9]+([._-][a-z0-9]+)*(/[a-z0-9]+([._-][a-z0-9]+)*)*$'
            AND position('..' in slug) = 0
            AND split_part(slug, '/', 1) NOT IN
              ('api', 'admin', 'login', 'register', 'account', '_next')
          ),
        ADD CONSTRAINT content_items_archive_state_check
          CHECK ((status = 'ARCHIVED') = (archived_at IS NOT NULL)),
        ADD CONSTRAINT content_items_archive_actor_check
          CHECK ((archived_at IS NULL) = (archived_by IS NULL));

      CREATE UNIQUE INDEX content_items_active_slug_unique
        ON stack_atlas.content_items (slug)
        WHERE archived_at IS NULL;

      ALTER TABLE stack_atlas.content_revisions
        ADD COLUMN created_by uuid REFERENCES stack_atlas.users(id) ON DELETE RESTRICT;

      CREATE FUNCTION stack_atlas.prevent_content_creator_mutation()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $function$
      BEGIN
        IF NEW.created_by IS DISTINCT FROM OLD.created_by THEN
          RAISE EXCEPTION 'content creator attribution is immutable' USING ERRCODE = '55000';
        END IF;
        RETURN NEW;
      END;
      $function$;

      CREATE TRIGGER content_items_creator_immutable
        BEFORE UPDATE OF created_by ON stack_atlas.content_items
        FOR EACH ROW EXECUTE FUNCTION stack_atlas.prevent_content_creator_mutation();
    `);
  }

  async down(queryRunner: PoolClient): Promise<void> {
    await queryRunner.query(`
      DO $migration$
      BEGIN
        IF EXISTS (SELECT 1 FROM stack_atlas.content_items) THEN
          RAISE EXCEPTION 'Refusing to roll back content lifecycle metadata while content items exist';
        END IF;
      END
      $migration$;

      DROP TRIGGER content_items_creator_immutable ON stack_atlas.content_items;
      DROP FUNCTION stack_atlas.prevent_content_creator_mutation();
      DROP INDEX stack_atlas.content_items_active_slug_unique;
      ALTER TABLE stack_atlas.content_revisions DROP COLUMN created_by;
      ALTER TABLE stack_atlas.content_items
        DROP CONSTRAINT content_items_archive_actor_check,
        DROP CONSTRAINT content_items_archive_state_check,
        DROP CONSTRAINT content_items_slug_check,
        DROP CONSTRAINT content_items_status_check,
        DROP COLUMN archived_by,
        DROP COLUMN archived_at,
        DROP COLUMN created_by,
        DROP COLUMN status,
        DROP COLUMN slug;
    `);
  }
}
