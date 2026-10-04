import type { PoolClient } from 'pg';
import type { MigrationInterface } from '../../../../database/migrations/migration.interface';

export class AddContentRouteRedirects1791131085082 implements MigrationInterface {
  async up(queryRunner: PoolClient): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE stack_atlas.content_route_redirects (
        source_slug text PRIMARY KEY
          CHECK (
            length(source_slug) BETWEEN 1 AND 255
            AND source_slug ~ '^articles/[a-z0-9]+(-[a-z0-9]+)*/[a-z0-9]+(-[a-z0-9]+)*$'
          ),
        content_item_id uuid NOT NULL
          REFERENCES stack_atlas.content_items(id) ON DELETE RESTRICT,
        created_by uuid
          REFERENCES stack_atlas.users(id) ON DELETE RESTRICT,
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE INDEX content_route_redirects_content_item_id_idx
        ON stack_atlas.content_route_redirects (content_item_id);

      CREATE FUNCTION stack_atlas.prevent_content_route_redirect_mutation()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $function$
      BEGIN
        RAISE EXCEPTION 'content route redirect history is immutable'
          USING ERRCODE = '55000';
      END;
      $function$;

      CREATE TRIGGER content_route_redirects_immutable
        BEFORE UPDATE OR DELETE ON stack_atlas.content_route_redirects
        FOR EACH ROW EXECUTE FUNCTION
          stack_atlas.prevent_content_route_redirect_mutation();
    `);
  }

  async down(queryRunner: PoolClient): Promise<void> {
    await queryRunner.query(`
      DO $migration$
      BEGIN
        IF EXISTS (SELECT 1 FROM stack_atlas.content_route_redirects) THEN
          RAISE EXCEPTION
            'Refusing to roll back content route redirect history while rows exist';
        END IF;
      END
      $migration$;

      DROP TABLE stack_atlas.content_route_redirects;
      DROP FUNCTION stack_atlas.prevent_content_route_redirect_mutation();
    `);
  }
}
