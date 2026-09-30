import type { PoolClient } from 'pg';
import type { MigrationInterface } from '../../../../database/migrations/migration.interface';

export class ContentPlatformFoundation1790731125157 implements MigrationInterface {
  async up(queryRunner: PoolClient): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE stack_atlas.content_items (
        id uuid PRIMARY KEY,
        content_key text NOT NULL UNIQUE
          CHECK (content_key ~ '^[a-z0-9][a-z0-9._:-]{0,254}$'),
        content_type text NOT NULL CHECK (content_type = 'article'),
        latest_revision_id uuid,
        published_revision_id uuid,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE stack_atlas.content_revisions (
        id uuid PRIMARY KEY,
        content_item_id uuid NOT NULL
          REFERENCES stack_atlas.content_items(id) ON DELETE RESTRICT,
        revision_number integer NOT NULL CHECK (revision_number > 0),
        schema_version smallint NOT NULL CHECK (schema_version > 0),
        document jsonb NOT NULL CHECK (jsonb_typeof(document) = 'object'),
        checksum_sha256 text NOT NULL
          CHECK (checksum_sha256 ~ '^[a-f0-9]{64}$'),
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT content_revisions_item_revision_unique
          UNIQUE (content_item_id, revision_number),
        CONSTRAINT content_revisions_id_item_unique
          UNIQUE (id, content_item_id)
      );

      CREATE TABLE stack_atlas.content_publications (
        id uuid PRIMARY KEY,
        content_item_id uuid NOT NULL,
        revision_id uuid NOT NULL,
        published_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT content_publications_revision_item_fk
          FOREIGN KEY (revision_id, content_item_id)
          REFERENCES stack_atlas.content_revisions(id, content_item_id)
          ON DELETE RESTRICT
      );

      ALTER TABLE stack_atlas.content_items
        ADD CONSTRAINT content_items_latest_revision_fk
        FOREIGN KEY (latest_revision_id, id)
        REFERENCES stack_atlas.content_revisions(id, content_item_id)
        DEFERRABLE INITIALLY DEFERRED;

      ALTER TABLE stack_atlas.content_items
        ADD CONSTRAINT content_items_published_revision_fk
        FOREIGN KEY (published_revision_id, id)
        REFERENCES stack_atlas.content_revisions(id, content_item_id)
        DEFERRABLE INITIALLY DEFERRED;

      CREATE FUNCTION stack_atlas.prevent_content_revision_mutation()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $function$
      BEGIN
        RAISE EXCEPTION 'content revisions are immutable' USING ERRCODE = '55000';
      END;
      $function$;

      CREATE TRIGGER content_revisions_immutable
        BEFORE UPDATE OR DELETE ON stack_atlas.content_revisions
        FOR EACH ROW EXECUTE FUNCTION stack_atlas.prevent_content_revision_mutation();

      CREATE FUNCTION stack_atlas.prevent_content_publication_mutation()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $function$
      BEGIN
        RAISE EXCEPTION 'content publication history is immutable' USING ERRCODE = '55000';
      END;
      $function$;

      CREATE TRIGGER content_publications_immutable
        BEFORE UPDATE OR DELETE ON stack_atlas.content_publications
        FOR EACH ROW EXECUTE FUNCTION stack_atlas.prevent_content_publication_mutation();

      CREATE FUNCTION stack_atlas.prevent_content_identity_mutation()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $function$
      BEGIN
        IF TG_OP = 'DELETE' THEN
          RAISE EXCEPTION 'content identity is immutable' USING ERRCODE = '55000';
        END IF;
        IF NEW.id IS DISTINCT FROM OLD.id
           OR NEW.content_key IS DISTINCT FROM OLD.content_key
           OR NEW.content_type IS DISTINCT FROM OLD.content_type
           OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
          RAISE EXCEPTION 'content identity is immutable' USING ERRCODE = '55000';
        END IF;
        RETURN NEW;
      END;
      $function$;

      CREATE TRIGGER content_items_identity_immutable
        BEFORE UPDATE OR DELETE ON stack_atlas.content_items
        FOR EACH ROW EXECUTE FUNCTION stack_atlas.prevent_content_identity_mutation();
    `);
  }

  async down(queryRunner: PoolClient): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE stack_atlas.content_items
        DROP CONSTRAINT content_items_published_revision_fk;
      ALTER TABLE stack_atlas.content_items
        DROP CONSTRAINT content_items_latest_revision_fk;
      DROP TABLE stack_atlas.content_publications;
      DROP TABLE stack_atlas.content_revisions;
      DROP TABLE stack_atlas.content_items;
      DROP FUNCTION stack_atlas.prevent_content_publication_mutation();
      DROP FUNCTION stack_atlas.prevent_content_revision_mutation();
      DROP FUNCTION stack_atlas.prevent_content_identity_mutation();
    `);
  }
}
