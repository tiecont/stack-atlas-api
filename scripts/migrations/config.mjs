import 'dotenv/config';

const verificationHosts = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  '[::1]',
  'postgres',
]);

function requiredPostgresUrl(value, name) {
  if (!value) throw new Error(`${name} is required.`);
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid PostgreSQL URL.`);
  }
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !url.hostname ||
    url.pathname.length < 2
  ) {
    throw new Error(`${name} must include a PostgreSQL host and database name.`);
  }
  return url;
}

export function getMigrationDatabaseUrl() {
  return requiredPostgresUrl(
    process.env['DATABASE_URL'],
    'DATABASE_URL',
  ).toString();
}

export function getVerificationAdminUrl(environment = process.env) {
  const url = requiredPostgresUrl(
    environment['DATABASE_VERIFY_ADMIN_URL'],
    'DATABASE_VERIFY_ADMIN_URL',
  );
  if (url.pathname !== '/postgres') {
    throw new Error(
      'DATABASE_VERIFY_ADMIN_URL must connect to the postgres maintenance database.',
    );
  }
  if (!verificationHosts.has(url.hostname.toLowerCase())) {
    throw new Error(
      'Disposable migration verification requires a local PostgreSQL host.',
    );
  }
  return url.toString();
}
