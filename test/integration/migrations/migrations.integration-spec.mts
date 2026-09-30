import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { DatabaseService } from '../../../src/database/database.service.js';
import { migrate } from '../../../scripts/migrations/runner.mjs';
import { requirePostgresTestDatabaseUrl } from '../../postgres-test-safety.js';

const testDatabaseUrl = requirePostgresTestDatabaseUrl();
const migrationDatabase = new URL(testDatabaseUrl);
migrationDatabase.pathname = '/stack_atlas_migration_test';
const databaseUrl = requirePostgresTestDatabaseUrl({
  ...process.env,
  DATABASE_TEST_URL: migrationDatabase.toString(),
});
let pool: Pool | undefined;

describe('PostgreSQL migrations', () => {
  const runMigrations = (direction: 'up' | 'down' | 'down-all') =>
    migrate(direction, databaseUrl);

  beforeAll(async () => {
    await runMigrations('up');
    pool = new Pool({ connectionString: databaseUrl });
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('creates the owned Stack Atlas schema and records the timestamped migration', async () => {
    const schema = await pool!.query(
      "SELECT to_regnamespace('stack_atlas') AS schema_name",
    );
    const history = await pool!.query('SELECT name FROM pgmigrations');
    const migrationNames = history.rows.map(
      (row: { name: string }) => row.name,
    );

    expect(schema.rows[0]?.schema_name).toBe('stack_atlas');
    expect(history.rowCount).toBe(3);
    expect(migrationNames).toEqual(
      expect.arrayContaining([
        '20260924072735_create_stack_atlas_schema',
        '20260924075252_create_identity_tables',
      ]),
    );
    expect(
      migrationNames.some((migrationName: string) =>
        /^\d{14}-\d{3}_identity-email-normalization$/.test(migrationName),
      ),
    ).toBe(true);
    const featureHistory = await pool!.query(
      'SELECT migration_name, migration_kind FROM public.stack_atlas_migration_history',
    );
    expect(featureHistory.rows).toEqual(
      expect.arrayContaining([
        {
          migration_name:
            'content/catalog/migrations/1790731125157-ContentPlatformFoundation.ts',
          migration_kind: 'schema',
        },
        {
          migration_name:
            'identity/platform-authorization/migrations/1790747319761-PlatformAuthorization.ts',
          migration_kind: 'schema',
        },
        {
          migration_name:
            'content/catalog/migrations/1790751260156-AddContentLifecycle.ts',
          migration_kind: 'schema',
        },
        {
          migration_name:
            'content/catalog/migrations/1790754919694-AddContentPublicationActor.ts',
          migration_kind: 'schema',
        },
        {
          migration_name:
            'content/catalog/migrations/1790754919880-AddContentListIndex.ts',
          migration_kind: 'schema',
        },
      ]),
    );
    const publicationActor = await pool!.query<{
      is_nullable: string;
      data_type: string;
    }>(
      `SELECT is_nullable, data_type
       FROM information_schema.columns
       WHERE table_schema = 'stack_atlas'
         AND table_name = 'content_publications'
         AND column_name = 'published_by'`,
    );
    expect(publicationActor.rows[0]).toEqual({
      is_nullable: 'YES',
      data_type: 'uuid',
    });
    const listIndex = await pool!.query<{ index_name: string }>(
      `SELECT indexname AS index_name
       FROM pg_indexes
       WHERE schemaname = 'stack_atlas'
         AND indexname = 'content_items_created_id_desc_idx'`,
    );
    expect(listIndex.rowCount).toBe(1);
    const ownedTables = await pool!.query(
      `SELECT count(*)::int AS count
       FROM information_schema.tables
       WHERE table_schema = 'stack_atlas'
         AND table_name IN (
           'users', 'sessions', 'content_items', 'content_revisions',
           'content_publications', 'platform_roles',
           'platform_role_permissions', 'user_platform_roles'
         )`,
    );
    expect(ownedTables.rows[0]?.count).toBe(8);
  });

  it('preserves published state when upgrading a legacy item with a publication pointer', async () => {
    await runMigrations('down');
    await runMigrations('down');
    await runMigrations('down');
    const accountId = randomUUID();
    const contentId = randomUUID();
    const revisionId = randomUUID();
    const contentKey = `article:legacy-${randomUUID()}`;

    await pool!.query(
      `INSERT INTO stack_atlas.users (id, email, password_hash)
       VALUES ($1, $2, $3)`,
      [
        accountId,
        `legacy-content-${accountId}@example.test`,
        'migration-test-hash',
      ],
    );
    await pool!.query(
      `INSERT INTO stack_atlas.content_items (id, content_key, content_type)
       VALUES ($1, $2, 'article')`,
      [contentId, contentKey],
    );
    await pool!.query(
      `INSERT INTO stack_atlas.content_revisions
         (id, content_item_id, revision_number, schema_version, document, checksum_sha256)
       VALUES ($1, $2, 1, 1, '{"schema_version":1}'::jsonb, $3)`,
      [revisionId, contentId, 'a'.repeat(64)],
    );
    await pool!.query(
      `INSERT INTO stack_atlas.content_publications (id, content_item_id, revision_id)
       VALUES ($1, $2, $3)`,
      [randomUUID(), contentId, revisionId],
    );
    await pool!.query(
      `UPDATE stack_atlas.content_items
       SET latest_revision_id = $2, published_revision_id = $2
       WHERE id = $1`,
      [contentId, revisionId],
    );

    await runMigrations('up');
    const upgraded = await pool!.query<{
      slug: string;
      status: string;
      latest_revision_id: string;
      published_revision_id: string;
    }>(
      `SELECT slug, status, latest_revision_id, published_revision_id
       FROM stack_atlas.content_items WHERE id = $1`,
      [contentId],
    );
    expect(upgraded.rows[0]).toEqual({
      slug: `legacy-${contentId.replaceAll('-', '')}`,
      status: 'PUBLISHED',
      latest_revision_id: revisionId,
      published_revision_id: revisionId,
    });
    await runMigrations('down');
    await runMigrations('down');
    await expect(runMigrations('down')).rejects.toThrow(
      'Refusing to roll back content lifecycle metadata while content items exist',
    );

    await pool!.query('TRUNCATE stack_atlas.content_items CASCADE');
    await pool!.query('DELETE FROM stack_atlas.users WHERE id = $1', [
      accountId,
    ]);
    await runMigrations('up');
  });

  it('keeps publisher attribution if rolling back its column would lose audit data', async () => {
    const accountId = randomUUID();
    const contentId = randomUUID();
    const revisionId = randomUUID();
    const contentKey = `article:publisher-audit-${randomUUID()}`;
    await pool!.query(
      `INSERT INTO stack_atlas.users (id, email, password_hash)
       VALUES ($1, $2, $3)`,
      [accountId, `publisher-audit-${accountId}@example.test`, 'test-hash'],
    );
    await pool!.query(
      `INSERT INTO stack_atlas.content_items
         (id, content_key, content_type, slug, created_by)
       VALUES ($1, $2, 'article', $3, $4)`,
      [contentId, contentKey, `publisher-audit-${contentId}`, accountId],
    );
    await pool!.query(
      `INSERT INTO stack_atlas.content_revisions
         (id, content_item_id, revision_number, schema_version, document,
          checksum_sha256, created_by)
       VALUES ($1, $2, 1, 1, '{"schema_version":1}'::jsonb, $3, $4)`,
      [revisionId, contentId, 'b'.repeat(64), accountId],
    );
    await pool!.query(
      `INSERT INTO stack_atlas.content_publications
         (id, content_item_id, revision_id, published_by)
       VALUES ($1, $2, $3, $4)`,
      [randomUUID(), contentId, revisionId, accountId],
    );

    await runMigrations('down');
    await expect(runMigrations('down')).rejects.toThrow(
      'Refusing to remove recorded publication actor attribution',
    );
    const publication = await pool!.query<{ published_by: string }>(
      `SELECT published_by FROM stack_atlas.content_publications
       WHERE content_item_id = $1`,
      [contentId],
    );
    expect(publication.rows[0]?.published_by).toBe(accountId);

    await pool!.query('TRUNCATE stack_atlas.content_items CASCADE');
    await pool!.query('DELETE FROM stack_atlas.users WHERE id = $1', [
      accountId,
    ]);
    await runMigrations('up');
  });

  it('normalizes upgrade rows and refuses normalization collisions without data loss', async () => {
    await runMigrations('down');
    await runMigrations('down');
    await runMigrations('down');
    await runMigrations('down');
    await runMigrations('down');
    await runMigrations('down');
    await pool!.query(
      'ALTER TABLE stack_atlas.users DROP CONSTRAINT users_email_normalized',
    );

    const upperId = randomUUID();
    const whitespaceId = randomUUID();
    const collisionId = randomUUID();
    const conflictingId = randomUUID();
    const invalidWriteId = randomUUID();
    const upperEmail = `UPPER-${upperId}@EXAMPLE.TEST`;
    const whitespaceEmail = `  Space-${whitespaceId}@Example.Test  `;
    const collisionEmail = `collision-${collisionId}@example.test`;
    const conflictingEmail = ` COLLISION-${collisionId}@Example.Test `;

    await pool!.query(
      `INSERT INTO stack_atlas.users (id, email, password_hash)
       VALUES ($1, $2, $3), ($4, $5, $3), ($6, $7, $3), ($8, $9, $3)`,
      [
        upperId,
        upperEmail,
        'migration-test-hash',
        whitespaceId,
        whitespaceEmail,
        collisionId,
        collisionEmail,
        conflictingId,
        conflictingEmail,
      ],
    );

    await expect(runMigrations('up')).rejects.toThrow(
      'Cannot normalize stack_atlas.users.email: found 1 collision group(s)',
    );
    const unchangedLegacyRows = await pool!.query(
      `SELECT id, email
       FROM stack_atlas.users
       WHERE id = ANY($1::uuid[])
       ORDER BY id`,
      [[upperId, whitespaceId, collisionId, conflictingId]],
    );
    expect(unchangedLegacyRows.rows).toHaveLength(4);
    expect(unchangedLegacyRows.rows).toEqual(
      expect.arrayContaining([
        { id: upperId, email: upperEmail },
        { id: whitespaceId, email: whitespaceEmail },
        { id: collisionId, email: collisionEmail },
        { id: conflictingId, email: conflictingEmail },
      ]),
    );

    await pool!.query('DELETE FROM stack_atlas.users WHERE id = $1', [
      conflictingId,
    ]);
    await runMigrations('up');

    const normalizedRows = await pool!.query(
      `SELECT id, email
       FROM stack_atlas.users
       WHERE id = ANY($1::uuid[])`,
      [[upperId, whitespaceId, collisionId]],
    );
    expect(normalizedRows.rows).toEqual(
      expect.arrayContaining([
        { id: upperId, email: `upper-${upperId}@example.test` },
        { id: whitespaceId, email: `space-${whitespaceId}@example.test` },
        { id: collisionId, email: `collision-${collisionId}@example.test` },
      ]),
    );

    await expect(
      pool!.query(
        `INSERT INTO stack_atlas.users (id, email, password_hash)
         VALUES ($1, $2, $3)`,
        [
          invalidWriteId,
          ` Invalid-${invalidWriteId}@Example.Test `,
          'test-hash',
        ],
      ),
    ).rejects.toMatchObject({ code: '23514' });

    await pool!.query(
      'DELETE FROM stack_atlas.users WHERE id = ANY($1::uuid[])',
      [[upperId, whitespaceId, collisionId]],
    );
  });

  it('enforces normalized email and session ownership in PostgreSQL', async () => {
    const accountId = randomUUID();
    await pool!.query(
      `INSERT INTO stack_atlas.users (id, email, password_hash)
       VALUES ($1, $2, $3)`,
      [accountId, `migration-${accountId}@example.test`, 'test-hash'],
    );

    await expect(
      pool!.query(
        `INSERT INTO stack_atlas.users (id, email, password_hash)
         VALUES ($1, $2, $3)`,
        [randomUUID(), ` migration-${accountId}@example.test `, 'test-hash'],
      ),
    ).rejects.toMatchObject({ code: '23514' });

    await expect(
      pool!.query(
        `INSERT INTO stack_atlas.sessions (id, user_id, token_hash, expires_at)
         VALUES ($1, $2, $3, now() + interval '1 day')`,
        [randomUUID(), randomUUID(), 'a'.repeat(64)],
      ),
    ).rejects.toMatchObject({ code: '23503' });
    await pool!.query('DELETE FROM stack_atlas.users WHERE id = $1', [
      accountId,
    ]);
  });

  it('commits and rolls back work through the shared transaction primitive', async () => {
    const database = new DatabaseService(pool!);
    const rolledBackAccountId = randomUUID();
    await expect(
      database.transaction(async (client) => {
        await client.query(
          `INSERT INTO stack_atlas.users (id, email, password_hash)
           VALUES ($1, $2, $3)`,
          [
            rolledBackAccountId,
            `rollback-${rolledBackAccountId}@example.test`,
            'test-hash',
          ],
        );
        throw new Error('force transaction rollback');
      }),
    ).rejects.toThrow('force transaction rollback');

    const rolledBack = await pool!.query(
      'SELECT id FROM stack_atlas.users WHERE id = $1',
      [rolledBackAccountId],
    );
    expect(rolledBack.rowCount).toBe(0);

    const committedAccountId = randomUUID();
    await database.transaction(async (client) => {
      await client.query(
        `INSERT INTO stack_atlas.users (id, email, password_hash)
         VALUES ($1, $2, $3)`,
        [
          committedAccountId,
          `commit-${committedAccountId}@example.test`,
          'test-hash',
        ],
      );
    });
    const committed = await pool!.query(
      'SELECT id FROM stack_atlas.users WHERE id = $1',
      [committedAccountId],
    );
    expect(committed.rowCount).toBe(1);
    await pool!.query('DELETE FROM stack_atlas.users WHERE id = $1', [
      committedAccountId,
    ]);
  });

  it('refuses to roll back a foundation schema after it contains objects', async () => {
    await pool!.query(
      'CREATE TABLE stack_atlas.migration_safety_probe (id integer)',
    );
    await runMigrations('down');
    await runMigrations('down');
    await runMigrations('down');
    await runMigrations('down');
    await runMigrations('down');
    await runMigrations('down');
    await runMigrations('down');
    await expect(runMigrations('down')).rejects.toThrow(
      'Refusing to drop the non-empty stack_atlas schema',
    );
    await pool!.query('DROP TABLE stack_atlas.migration_safety_probe');
  });

  it('can roll back the empty schema in the disposable local test database', async () => {
    await runMigrations('down');
    const schema = await pool!.query(
      "SELECT to_regnamespace('stack_atlas') AS schema_name",
    );
    expect(schema.rows[0]?.schema_name).toBeNull();
  });
});
