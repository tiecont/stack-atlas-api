import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../../../database/database.service';
import type { PlatformRole } from '../constants/platform-permissions';

export interface RoleAssignmentState {
  accountExists: boolean;
  roleExists: boolean;
  assigned: boolean;
}

interface PermissionRow {
  permission: string;
}

interface AssignmentRow {
  account_exists: boolean;
  role_exists: boolean;
  assigned: boolean;
}

@Injectable()
export class PlatformAuthorizationRepository {
  constructor(private readonly database: DatabaseService) {}

  async findPermissions(
    accountId: string,
    sessionId: string,
  ): Promise<string[]> {
    const result = await this.database.query<PermissionRow>(
      `SELECT DISTINCT permission.permission
       FROM stack_atlas.user_platform_roles AS assignment
       JOIN stack_atlas.platform_role_permissions AS permission ON permission.role_key = assignment.role_key
       JOIN stack_atlas.sessions AS session ON session.user_id = assignment.user_id
       WHERE assignment.user_id = $1 AND session.id = $2
         AND session.revoked_at IS NULL AND session.expires_at > now()
       ORDER BY permission.permission`,
      [accountId, sessionId],
    );
    return result.rows.map((row) => row.permission);
  }

  async inspectAssignment(
    accountId: string,
    role: PlatformRole,
  ): Promise<RoleAssignmentState> {
    const result = await this.database.query<AssignmentRow>(
      `SELECT
         EXISTS (SELECT 1 FROM stack_atlas.users WHERE id = $1) AS account_exists,
         EXISTS (SELECT 1 FROM stack_atlas.platform_roles WHERE role_key = $2) AS role_exists,
         EXISTS (
           SELECT 1 FROM stack_atlas.user_platform_roles
           WHERE user_id = $1 AND role_key = $2
         ) AS assigned`,
      [accountId, role],
    );
    const row = result.rows[0];
    if (!row) throw new Error('Role assignment inspection returned no row.');
    return {
      accountExists: row.account_exists,
      roleExists: row.role_exists,
      assigned: row.assigned,
    };
  }

  async changeAssignment(
    accountId: string,
    role: PlatformRole,
    assigned: boolean,
  ): Promise<boolean | null> {
    return this.database.transaction(async (client) => {
      const account = await client.query(
        'SELECT id FROM stack_atlas.users WHERE id = $1 FOR KEY SHARE',
        [accountId],
      );
      if (account.rowCount === 0) return null;
      const result = assigned
        ? await client.query(
            'INSERT INTO stack_atlas.user_platform_roles (user_id, role_key) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [accountId, role],
          )
        : await client.query(
            'DELETE FROM stack_atlas.user_platform_roles WHERE user_id = $1 AND role_key = $2',
            [accountId, role],
          );
      return result.rowCount === 1;
    });
  }
}
