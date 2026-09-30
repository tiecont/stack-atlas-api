import { NestFactory } from '@nestjs/core';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ACCOUNT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parsePlatformAuthorizationCommand(arguments_) {
  const [action, ...options] = arguments_;
  if (action !== 'preflight' && action !== 'apply' && action !== 'verify') {
    throw new Error(usage());
  }

  const parsedOptions = new Map();
  for (let index = 0; index < options.length; index += 1) {
    const option = options[index];
    const name = option?.startsWith('--') ? option.slice(2) : '';
    const value = options[index + 1];
    if (
      !['account-id', 'role', 'operation', 'confirm'].includes(name) ||
      !value ||
      value.startsWith('--') ||
      parsedOptions.has(name)
    ) {
      throw new Error(usage());
    }
    parsedOptions.set(name, value);
    index += 1;
  }

  const accountId = parsedOptions.get('account-id');
  const role = parsedOptions.get('role');
  const operation = parsedOptions.get('operation');
  const confirmation = parsedOptions.get('confirm');
  if (
    !accountId ||
    !ACCOUNT_ID_PATTERN.test(accountId) ||
    !role ||
    (operation !== 'grant' && operation !== 'revoke')
  ) {
    throw new Error(usage());
  }

  const expectedConfirmation = `${accountId}:${role}:${operation}`;
  if (
    (action === 'apply' && confirmation !== expectedConfirmation) ||
    (action !== 'apply' && confirmation !== undefined)
  ) {
    throw new Error(
      action === 'apply'
        ? `Apply requires --confirm ${expectedConfirmation}.`
        : usage(),
    );
  }

  return { action, accountId, role, operation };
}

export async function executePlatformAuthorizationCommand(
  command,
  service,
  write = console.log,
) {
  const current = await service.inspectRoleAssignment(
    command.accountId,
    command.role,
  );
  assertTargetExists(current);
  const desired = command.operation === 'grant';

  if (command.action === 'preflight') {
    const outcome =
      current.assigned === desired ? 'idempotent no-op' : 'change required';
    write(
      `Preflight passed: account ${command.accountId}, role ${command.role}, ${command.operation}; ${outcome}. No writes were made.`,
    );
    return;
  }

  if (command.action === 'verify') {
    if (current.assigned !== desired) {
      throw new Error(
        `Verification failed: role ${command.role} is ${current.assigned ? 'granted' : 'not granted'} for account ${command.accountId}.`,
      );
    }
    write(
      `Verification passed: role ${command.role} is ${desired ? 'granted' : 'revoked'} for account ${command.accountId}.`,
    );
    return;
  }

  const result = await service.changeRoleAssignment(
    command.accountId,
    command.role,
    desired,
  );
  const verified = await service.inspectRoleAssignment(
    command.accountId,
    command.role,
  );
  assertTargetExists(verified);
  if (verified.assigned !== desired) {
    throw new Error(
      'Post-apply verification failed; inspect the database state.',
    );
  }
  write(
    `Apply verified: role ${command.role} ${command.operation === 'grant' ? 'granted' : 'revoked'} for account ${command.accountId}; changed=${result.changed}.`,
  );
}

async function run(arguments_) {
  const command = parsePlatformAuthorizationCommand(arguments_);
  const [{ AppModule }, { PlatformAuthorizationService }] = await Promise.all([
    import('../../dist/app.module.js'),
    import('../../dist/modules/identity/platform-authorization/services/platform-authorization.service.js'),
  ]);
  const application = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });
  try {
    const service = application.get(PlatformAuthorizationService);
    await executePlatformAuthorizationCommand(command, service);
  } finally {
    await application.close();
  }
}

function assertTargetExists(state) {
  if (!state.accountExists)
    throw new Error('The target account does not exist.');
  if (!state.roleExists) {
    throw new Error(
      'The platform role is not installed; apply database migrations first.',
    );
  }
}

function usage() {
  return [
    'Usage:',
    '  npm run platform:authorization -- preflight --account-id <uuid> --role <role> --operation grant|revoke',
    '  npm run platform:authorization -- apply --account-id <uuid> --role <role> --operation grant|revoke --confirm <uuid>:<role>:<operation>',
    '  npm run platform:authorization -- verify --account-id <uuid> --role <role> --operation grant|revoke',
  ].join('\n');
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  run(process.argv.slice(2)).catch((error) => {
    console.error(
      error instanceof Error ? error.message : 'Authorization command failed.',
    );
    process.exitCode = 1;
  });
}
