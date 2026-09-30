import { describe, expect, it, vi } from 'vitest';
import {
  executePlatformAuthorizationCommand,
  parsePlatformAuthorizationCommand,
} from '../../../scripts/identity/platform-authorization-admin.mjs';
import type { PlatformAuthorizationCommandService } from '../../../scripts/identity/platform-authorization-admin.mjs';

const accountId = '20000000-0000-4000-8000-000000000001';

function createService(assigned = false): PlatformAuthorizationCommandService {
  return {
    inspectRoleAssignment: vi.fn().mockResolvedValue({
      accountExists: true,
      roleExists: true,
      assigned,
    }),
    changeRoleAssignment: vi.fn().mockResolvedValue({ changed: true }),
  };
}

describe('platform authorization operator command', () => {
  it('requires exact target confirmation before an apply command can be parsed', () => {
    expect(() =>
      parsePlatformAuthorizationCommand([
        'apply',
        '--account-id',
        accountId,
        '--role',
        'platform-admin',
        '--operation',
        'grant',
      ]),
    ).toThrow('--confirm');

    expect(
      parsePlatformAuthorizationCommand([
        'apply',
        '--account-id',
        accountId,
        '--role',
        'platform-admin',
        '--operation',
        'grant',
        '--confirm',
        `${accountId}:platform-admin:grant`,
      ]),
    ).toMatchObject({ action: 'apply', accountId, role: 'platform-admin' });
  });

  it('keeps preflight and verification read-only', async () => {
    const service = createService();
    const output = vi.fn();
    const command = parsePlatformAuthorizationCommand([
      'preflight',
      '--account-id',
      accountId,
      '--role',
      'platform-admin',
      '--operation',
      'grant',
    ]);

    await executePlatformAuthorizationCommand(command, service, output);

    expect(service.inspectRoleAssignment).toHaveBeenCalledOnce();
    expect(service.changeRoleAssignment).not.toHaveBeenCalled();
    expect(output).toHaveBeenCalledWith(
      expect.stringContaining('No writes were made.'),
    );

    const verification = parsePlatformAuthorizationCommand([
      'verify',
      '--account-id',
      accountId,
      '--role',
      'platform-admin',
      '--operation',
      'revoke',
    ]);
    await executePlatformAuthorizationCommand(verification, service, output);
    expect(service.changeRoleAssignment).not.toHaveBeenCalled();
  });

  it('applies through the service and verifies durable state afterward', async () => {
    const service = createService(false);
    vi.mocked(service.inspectRoleAssignment)
      .mockResolvedValueOnce({
        accountExists: true,
        roleExists: true,
        assigned: false,
      })
      .mockResolvedValueOnce({
        accountExists: true,
        roleExists: true,
        assigned: true,
      });
    const output = vi.fn();
    const command = parsePlatformAuthorizationCommand([
      'apply',
      '--account-id',
      accountId,
      '--role',
      'platform-admin',
      '--operation',
      'grant',
      '--confirm',
      `${accountId}:platform-admin:grant`,
    ]);

    await executePlatformAuthorizationCommand(command, service, output);

    expect(service.changeRoleAssignment).toHaveBeenCalledWith(
      accountId,
      'platform-admin',
      true,
    );
    expect(service.inspectRoleAssignment).toHaveBeenCalledTimes(2);
    expect(output).toHaveBeenCalledWith(
      expect.stringContaining('changed=true'),
    );
  });
});
