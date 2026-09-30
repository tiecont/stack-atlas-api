import { describe, expect, it } from 'vitest';
import {
  getTestDatabaseAdminUrl,
  testDatabaseNames,
} from '../../../scripts/testing/create-test-databases.mjs';

const validEnvironment = {
  NODE_ENV: 'test',
  ALLOW_DESTRUCTIVE_TEST_DATABASE: 'true',
  DATABASE_VERIFY_ADMIN_URL:
    'postgresql://stack_atlas:local@127.0.0.1:5432/postgres',
};

describe('isolated PostgreSQL test database creation', () => {
  it('uses only the fixed disposable integration and e2e database names', () => {
    expect(testDatabaseNames).toEqual([
      'stack_atlas_integration_test',
      'stack_atlas_e2e_test',
    ]);
    expect(getTestDatabaseAdminUrl(validEnvironment)).toBe(
      validEnvironment.DATABASE_VERIFY_ADMIN_URL,
    );
  });

  it('requires test mode and the explicit destructive-test opt-in', () => {
    expect(() =>
      getTestDatabaseAdminUrl({
        ...validEnvironment,
        NODE_ENV: 'production',
      }),
    ).toThrow('NODE_ENV=test');
    expect(() =>
      getTestDatabaseAdminUrl({
        ...validEnvironment,
        ALLOW_DESTRUCTIVE_TEST_DATABASE: 'false',
      }),
    ).toThrow('ALLOW_DESTRUCTIVE_TEST_DATABASE=true');
  });

  it('accepts the explicit local Compose PostgreSQL service hostname', () => {
    expect(
      getTestDatabaseAdminUrl({
        ...validEnvironment,
        DATABASE_VERIFY_ADMIN_URL:
          'postgresql://stack_atlas:local@postgres:5432/postgres',
      }),
    ).toBe('postgresql://stack_atlas:local@postgres:5432/postgres');
  });

  it('rejects an admin URL that does not target the local postgres database', () => {
    expect(() =>
      getTestDatabaseAdminUrl({
        ...validEnvironment,
        DATABASE_VERIFY_ADMIN_URL:
          'postgresql://stack_atlas:local@db.example.test:5432/postgres',
      }),
    ).toThrow('local postgres');
    expect(() =>
      getTestDatabaseAdminUrl({
        ...validEnvironment,
        DATABASE_VERIFY_ADMIN_URL:
          'postgresql://stack_atlas:local@127.0.0.1:5432/stack_atlas_prod',
      }),
    ).toThrow('local postgres');
  });
});
