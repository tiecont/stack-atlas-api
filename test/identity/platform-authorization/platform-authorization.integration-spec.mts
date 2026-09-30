import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseService } from '../../../src/database/database.service.js';
import { PLATFORM_PERMISSION } from '../../../src/modules/identity/platform-authorization/constants/platform-permissions.js';
import { PlatformAuthorizationRepository } from '../../../src/modules/identity/platform-authorization/repositories/platform-authorization.repository.js';
import { PlatformAuthorizationService } from '../../../src/modules/identity/platform-authorization/services/platform-authorization.service.js';
import { migrate } from '../../../scripts/migrations/runner.mjs';
import { requirePostgresTestDatabaseUrl } from '../../postgres-test-safety.js';

const databaseUrl = requirePostgresTestDatabaseUrl();
let pool: Pool | undefined;

describe('PostgreSQL platform authorization', () => {
  beforeAll(async () => {
    await migrate('up', databaseUrl);
    pool = new Pool({ connectionString: databaseUrl });
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('resolves current permissions across roles and reflects revocation immediately', async () => {
    const accountId = randomUUID();
    const sessionId = randomUUID();
    const email = `platform-auth-${randomUUID()}@example.test`;
    const database = new DatabaseService(pool!);
    const service = new PlatformAuthorizationService(
      new PlatformAuthorizationRepository(database),
    );
    const principal = { accountId, sessionId, email };

    await pool!.query(
      'INSERT INTO stack_atlas.users (id, email, password_hash) VALUES ($1, $2, $3)',
      [accountId, email, 'integration-only-hash'],
    );
    await pool!.query(
      `INSERT INTO stack_atlas.sessions (id, user_id, token_hash, expires_at)
       VALUES ($1, $2, $3, now() + interval '1 hour')`,
      [sessionId, accountId, randomUUID().replaceAll('-', '').padEnd(64, '0')],
    );

    try {
      await expect(service.resolvePermissions(principal)).resolves.toEqual([]);

      await expect(
        service.changeRoleAssignment(accountId, 'content-editor', true),
      ).resolves.toEqual({ changed: true });
      await expect(
        service.changeRoleAssignment(accountId, 'content-editor', true),
      ).resolves.toEqual({ changed: false });
      await expect(
        service.changeRoleAssignment(accountId, 'content-publisher', true),
      ).resolves.toEqual({ changed: true });

      const permissions = await service.resolvePermissions(principal);
      expect(permissions).toEqual([
        PLATFORM_PERMISSION.ADMIN_DASHBOARD,
        PLATFORM_PERMISSION.CONTENT_ARCHIVE,
        PLATFORM_PERMISSION.CONTENT_CREATE,
        PLATFORM_PERMISSION.CONTENT_PUBLISH,
        PLATFORM_PERMISSION.CONTENT_READ,
        PLATFORM_PERMISSION.CONTENT_UPDATE,
      ]);
      await expect(
        service.hasPermissions(principal, [
          PLATFORM_PERMISSION.CONTENT_CREATE,
          PLATFORM_PERMISSION.CONTENT_PUBLISH,
        ]),
      ).resolves.toBe(true);

      await expect(
        service.changeRoleAssignment(accountId, 'content-publisher', false),
      ).resolves.toEqual({ changed: true });
      await expect(service.resolvePermissions(principal)).resolves.toEqual([
        PLATFORM_PERMISSION.ADMIN_DASHBOARD,
        PLATFORM_PERMISSION.CONTENT_CREATE,
        PLATFORM_PERMISSION.CONTENT_READ,
        PLATFORM_PERMISSION.CONTENT_UPDATE,
      ]);
      await expect(
        service.hasPermissions(principal, [
          PLATFORM_PERMISSION.CONTENT_PUBLISH,
        ]),
      ).resolves.toBe(false);

      await expect(
        pool!.query(
          `INSERT INTO stack_atlas.platform_role_permissions (role_key, permission)
           VALUES ('content-editor', 'content:delete')`,
        ),
      ).rejects.toMatchObject({ code: '23514' });
      const permissionCount = await pool!.query<{ count: string }>(
        `SELECT count(*)::text AS count
         FROM stack_atlas.platform_role_permissions WHERE role_key = 'content-editor'`,
      );
      expect(permissionCount.rows[0]?.count).toBe('4');

      await pool!.query(
        'UPDATE stack_atlas.sessions SET revoked_at = now() WHERE id = $1',
        [sessionId],
      );
      await expect(service.resolvePermissions(principal)).resolves.toEqual([]);
    } finally {
      await pool!.query('DELETE FROM stack_atlas.users WHERE id = $1', [
        accountId,
      ]);
    }
  });
});
