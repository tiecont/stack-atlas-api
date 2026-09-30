import { describe, expect, it, vi } from 'vitest';
import { PLATFORM_PERMISSION } from '../constants/platform-permissions';
import { PlatformAuthorizationInputError } from '../errors/platform-authorization.errors';
import { PlatformAuthorizationService } from './platform-authorization.service';
import type { PlatformAuthorizationRepository } from '../repositories/platform-authorization.repository';

const principal = {
  accountId: '20000000-0000-4000-8000-000000000001',
  sessionId: '30000000-0000-4000-8000-000000000001',
  email: 'ignored@example.test',
};

function createRepository() {
  return {
    findPermissions: vi.fn(),
    inspectAssignment: vi.fn(),
    changeAssignment: vi.fn(),
  } satisfies Pick<
    PlatformAuthorizationRepository,
    'findPermissions' | 'inspectAssignment' | 'changeAssignment'
  >;
}

describe('PlatformAuthorizationService', () => {
  it('requires every known permission and denies unknown permission values', async () => {
    const repository = createRepository();
    repository.findPermissions.mockResolvedValue([
      PLATFORM_PERMISSION.CONTENT_READ,
      PLATFORM_PERMISSION.CONTENT_UPDATE,
    ]);
    const service = new PlatformAuthorizationService(repository);

    await expect(
      service.hasPermissions(principal, [
        PLATFORM_PERMISSION.CONTENT_READ,
        PLATFORM_PERMISSION.CONTENT_UPDATE,
      ]),
    ).resolves.toBe(true);
    await expect(
      service.hasPermissions(principal, [
        PLATFORM_PERMISSION.CONTENT_READ,
        PLATFORM_PERMISSION.CONTENT_PUBLISH,
      ]),
    ).resolves.toBe(false);
    await expect(
      service.hasPermissions(principal, ['content:delete']),
    ).resolves.toBe(false);
    await expect(service.hasPermissions(principal, [])).resolves.toBe(false);
    expect(repository.findPermissions).toHaveBeenCalledTimes(2);
  });

  it('fails closed for malformed principal identifiers and unknown database permissions', async () => {
    const repository = createRepository();
    repository.findPermissions.mockResolvedValue(['content:delete']);
    const service = new PlatformAuthorizationService(repository);

    await expect(
      service.resolvePermissions({ ...principal, sessionId: 'not-a-uuid' }),
    ).resolves.toEqual([]);
    expect(repository.findPermissions).not.toHaveBeenCalled();
    await expect(service.resolvePermissions(principal)).resolves.toEqual([]);
  });

  it('validates operator targets before any repository write', async () => {
    const repository = createRepository();
    const service = new PlatformAuthorizationService(repository);

    await expect(
      service.changeRoleAssignment('not-a-uuid', 'platform-admin', true),
    ).rejects.toBeInstanceOf(PlatformAuthorizationInputError);
    await expect(
      service.changeRoleAssignment(
        principal.accountId,
        'unknown-role' as never,
        true,
      ),
    ).rejects.toBeInstanceOf(PlatformAuthorizationInputError);
    expect(repository.changeAssignment).not.toHaveBeenCalled();
  });

  it('checks account and role existence before changing an assignment', async () => {
    const repository = createRepository();
    repository.inspectAssignment.mockResolvedValue({
      accountExists: true,
      roleExists: true,
      assigned: false,
    });
    repository.changeAssignment.mockResolvedValue(true);
    const service = new PlatformAuthorizationService(repository);

    await expect(
      service.changeRoleAssignment(principal.accountId, 'platform-admin', true),
    ).resolves.toEqual({ changed: true });
    expect(repository.changeAssignment).toHaveBeenCalledWith(
      principal.accountId,
      'platform-admin',
      true,
    );
  });
});
