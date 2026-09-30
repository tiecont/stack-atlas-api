const SAFE_DATABASE_NAME =
  /^stack_atlas_(?:test|migration_test|integration_test|e2e_test)$/;
const SAFE_DATABASE_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  '[::1]',
  'postgres',
]);

export function requirePostgresTestDatabaseUrl(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): string {
  if (environment['NODE_ENV'] !== 'test') {
    throw new Error('PostgreSQL tests require NODE_ENV=test.');
  }
  if (environment['ALLOW_DESTRUCTIVE_TEST_DATABASE'] !== 'true') {
    throw new Error(
      'PostgreSQL tests require ALLOW_DESTRUCTIVE_TEST_DATABASE=true.',
    );
  }

  const value = environment['DATABASE_TEST_URL'];
  if (!value) {
    throw new Error('PostgreSQL tests require DATABASE_TEST_URL.');
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('DATABASE_TEST_URL must be a valid PostgreSQL URL.');
  }

  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error('DATABASE_TEST_URL must use PostgreSQL.');
  }
  if (!SAFE_DATABASE_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error(
      `Refusing PostgreSQL tests against non-local host "${url.hostname}".`,
    );
  }

  const databaseName = decodeURIComponent(url.pathname.slice(1)).toLowerCase();
  if (!SAFE_DATABASE_NAME.test(databaseName)) {
    throw new Error(
      `Refusing PostgreSQL tests against unsafe database "${databaseName}".`,
    );
  }

  return value;
}
