import { Inject, Injectable } from '@nestjs/common';
import type { AuthenticatedPrincipal } from '../../authentication/types/authenticated-principal';
import {
  isPlatformPermission,
  isPlatformRole,
} from '../constants/platform-permissions';
import type {
  PlatformPermission,
  PlatformRole,
} from '../constants/platform-permissions';
import {
  PlatformAuthorizationAccountNotFoundError,
  PlatformAuthorizationInputError,
  PlatformAuthorizationRoleNotFoundError,
} from '../errors/platform-authorization.errors';
import { PlatformAuthorizationRepository } from '../repositories/platform-authorization.repository';
import type { RoleAssignmentState } from '../repositories/platform-authorization.repository';

type PlatformAuthorizationStore = Pick<
  PlatformAuthorizationRepository,
  'findPermissions' | 'inspectAssignment' | 'changeAssignment'
>;

@Injectable()
export class PlatformAuthorizationService {
  constructor(
    @Inject(PlatformAuthorizationRepository)
    private readonly repository: PlatformAuthorizationStore,
  ) {}

  async hasPermissions(
    principal: AuthenticatedPrincipal,
    required: readonly unknown[],
  ): Promise<boolean> {
    if (required.length === 0 || !required.every(isPlatformPermission))
      return false;
    const granted = await this.resolvePermissions(principal);
    return required.every((permission) => granted.includes(permission));
  }

  async resolvePermissions(
    principal: AuthenticatedPrincipal,
  ): Promise<PlatformPermission[]> {
    if (
      !principal ||
      !isAccountId(principal.accountId) ||
      !isAccountId(principal.sessionId)
    ) {
      return [];
    }
    const permissions = await this.repository.findPermissions(
      principal.accountId,
      principal.sessionId,
    );
    // Fail closed if database/reference data ever drifts beyond the fixed vocabulary.
    if (!permissions.every(isPlatformPermission)) return [];
    return permissions;
  }

  inspectRoleAssignment(
    accountId: string,
    role: PlatformRole,
  ): Promise<RoleAssignmentState> {
    validateTarget(accountId, role);
    return this.repository.inspectAssignment(accountId, role);
  }

  /** Operator-only entry point. No HTTP adapter exposes assignment mutations. */
  async changeRoleAssignment(
    accountId: string,
    role: PlatformRole,
    assigned: boolean,
  ): Promise<{ changed: boolean }> {
    validateTarget(accountId, role);
    if (typeof assigned !== 'boolean')
      throw new PlatformAuthorizationInputError();
    const state = await this.repository.inspectAssignment(accountId, role);
    if (!state.accountExists)
      throw new PlatformAuthorizationAccountNotFoundError();
    if (!state.roleExists) throw new PlatformAuthorizationRoleNotFoundError();
    const changed = await this.repository.changeAssignment(
      accountId,
      role,
      assigned,
    );
    if (changed === null) throw new PlatformAuthorizationAccountNotFoundError();
    return { changed };
  }
}

function isAccountId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

function validateTarget(accountId: string, role: PlatformRole): void {
  if (!isAccountId(accountId) || !isPlatformRole(role)) {
    throw new PlatformAuthorizationInputError();
  }
}
