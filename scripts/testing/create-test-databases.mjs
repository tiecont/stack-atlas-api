import { Pool } from 'pg';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const testDatabaseNames = Object.freeze([
  'stack_atlas_integration_test',
  'stack_atlas_e2e_test',
]);

export function getTestDatabaseAdminUrl(
  environment = process.env,
) {
  if (environment['NODE_ENV'] !== 'test') {
    throw new Error('Test database creation requires NODE_ENV=test.');
  }
  if (environment['ALLOW_DESTRUCTIVE_TEST_DATABASE'] !== 'true') {
    throw new Error(
      'Test database creation requires ALLOW_DESTRUCTIVE_TEST_DATABASE=true.',
    );
  }
  const adminUrlValue = environment['DATABASE_VERIFY_ADMIN_URL'];
  if (!adminUrlValue) {
    throw new Error('DATABASE_VERIFY_ADMIN_URL is required.');
  }

  let adminUrl;
  try {
    adminUrl = new URL(adminUrlValue);
  } catch {
    throw new Error('DATABASE_VERIFY_ADMIN_URL must be a valid PostgreSQL URL.');
  }
  if (
    !['postgres:', 'postgresql:'].includes(adminUrl.protocol) ||
    adminUrl.pathname !== '/postgres' ||
    !['localhost', '127.0.0.1', '::1', '[::1]', 'postgres'].includes(
      adminUrl.hostname.toLowerCase(),
    )
  ) {
    throw new Error(
      'Refusing test database creation unless the admin URL targets local postgres.',
    );
  }
  return adminUrl.toString();
}

export async function createTestDatabases(environment = process.env) {
  const adminUrl = getTestDatabaseAdminUrl(environment);
  const pool = new Pool({ connectionString: adminUrl });
  const created = [];
  try {
    const current = await pool.query('SELECT current_database() AS name');
    if (current.rows[0]?.name !== 'postgres') {
      throw new Error('Refusing test database creation outside postgres database.');
    }

    for (const name of testDatabaseNames) {
      const existing = await pool.query(
        'SELECT 1 FROM pg_database WHERE datname = $1',
        [name],
      );
      if (existing.rowCount !== 0) {
        throw new Error(`Refusing to replace existing test database "${name}".`);
      }
      await pool.query(`CREATE DATABASE "${name}"`);
      created.push(name);
    }
    console.log(`Created disposable test databases: ${testDatabaseNames.join(', ')}.`);
  } catch (error) {
    for (const name of created.reverse()) {
      await pool.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    }
    throw error;
  } finally {
    await pool.end();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  createTestDatabases().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Test database creation failed.');
    process.exitCode = 1;
  });
}
