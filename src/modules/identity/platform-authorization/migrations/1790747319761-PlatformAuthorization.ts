import type { PoolClient } from 'pg';
import type { MigrationInterface } from '../../../../database/migrations/migration.interface';

export class PlatformAuthorization1790747319761 implements MigrationInterface {
  async up(queryRunner: PoolClient): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE stack_atlas.platform_roles (
        role_key text PRIMARY KEY CHECK (role_key IN ('platform-admin', 'content-editor', 'content-publisher'))
      );
      CREATE TABLE stack_atlas.platform_role_permissions (
        role_key text NOT NULL REFERENCES stack_atlas.platform_roles(role_key) ON DELETE CASCADE,
        permission text NOT NULL CHECK (permission IN ('admin:dashboard', 'content:read', 'content:create', 'content:update', 'content:publish', 'content:archive')),
        PRIMARY KEY (role_key, permission)
      );
      CREATE TABLE stack_atlas.user_platform_roles (
        user_id uuid NOT NULL REFERENCES stack_atlas.users(id) ON DELETE CASCADE,
        role_key text NOT NULL REFERENCES stack_atlas.platform_roles(role_key) ON DELETE CASCADE,
        granted_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (user_id, role_key)
      );
      CREATE INDEX user_platform_roles_role_idx ON stack_atlas.user_platform_roles(role_key);
      INSERT INTO stack_atlas.platform_roles (role_key) VALUES ('platform-admin'), ('content-editor'), ('content-publisher');
      INSERT INTO stack_atlas.platform_role_permissions (role_key, permission) VALUES
        ('platform-admin', 'admin:dashboard'), ('platform-admin', 'content:read'),
        ('platform-admin', 'content:create'), ('platform-admin', 'content:update'),
        ('platform-admin', 'content:publish'), ('platform-admin', 'content:archive'),
        ('content-editor', 'admin:dashboard'), ('content-editor', 'content:read'),
        ('content-editor', 'content:create'), ('content-editor', 'content:update'),
        ('content-publisher', 'admin:dashboard'), ('content-publisher', 'content:read'),
        ('content-publisher', 'content:publish'), ('content-publisher', 'content:archive');
    `);
  }

  async down(queryRunner: PoolClient): Promise<void> {
    await queryRunner.query(`
      DROP TABLE stack_atlas.user_platform_roles;
      DROP TABLE stack_atlas.platform_role_permissions;
      DROP TABLE stack_atlas.platform_roles;
    `);
  }
}
