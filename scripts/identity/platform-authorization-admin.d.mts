import type { PlatformRole } from '../../src/modules/identity/platform-authorization/constants/platform-permissions.js';
import type { RoleAssignmentState } from '../../src/modules/identity/platform-authorization/repositories/platform-authorization.repository.js';

export type PlatformAuthorizationCommand = {
  action: 'preflight' | 'apply' | 'verify';
  accountId: string;
  role: PlatformRole;
  operation: 'grant' | 'revoke';
};

export interface PlatformAuthorizationCommandService {
  inspectRoleAssignment(
    accountId: string,
    role: PlatformRole,
  ): Promise<RoleAssignmentState>;
  changeRoleAssignment(
    accountId: string,
    role: PlatformRole,
    assigned: boolean,
  ): Promise<{ changed: boolean }>;
}

export function parsePlatformAuthorizationCommand(
  arguments_: readonly string[],
): PlatformAuthorizationCommand;
export function executePlatformAuthorizationCommand(
  command: PlatformAuthorizationCommand,
  service: PlatformAuthorizationCommandService,
  write?: (message: string) => void,
): Promise<void>;
