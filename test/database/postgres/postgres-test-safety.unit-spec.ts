import { describe, expect, it } from 'vitest';
import { requirePostgresTestDatabaseUrl } from '../../postgres-test-safety';

function testEnvironment(databaseUrl: string) {
  return {
    NODE_ENV: 'test',
    ALLOW_DESTRUCTIVE_TEST_DATABASE: 'true',
    DATABASE_TEST_URL: databaseUrl,
  };
}

describe('PostgreSQL test database safety', () => {
  it('accepts a local database with a Stack Atlas test-only name', () => {
    const databaseUrl =
      'postgresql://stack_atlas:local@127.0.0.1:5432/stack_atlas_integration_test';

    expect(requirePostgresTestDatabaseUrl(testEnvironment(databaseUrl))).toBe(
      databaseUrl,
    );
    const migrationDatabaseUrl =
      'postgresql://stack_atlas:local@127.0.0.1:5432/stack_atlas_migration_test';
    expect(
      requirePostgresTestDatabaseUrl(testEnvironment(migrationDatabaseUrl)),
    ).toBe(migrationDatabaseUrl);
  });

  it('requires the explicit destructive-test opt-in', () => {
    expect(() =>
      requirePostgresTestDatabaseUrl({
        NODE_ENV: 'test',
        DATABASE_TEST_URL:
          'postgresql://stack_atlas:local@127.0.0.1:5432/stack_atlas_test',
      }),
    ).toThrow('ALLOW_DESTRUCTIVE_TEST_DATABASE=true');
  });

  it('rejects remote hosts and databases without an approved test suffix', () => {
    expect(() =>
      requirePostgresTestDatabaseUrl(
        testEnvironment(
          'postgresql://user:secret@db.example.test:5432/stack_atlas_test',
        ),
      ),
    ).toThrow('non-local host');

    expect(() =>
      requirePostgresTestDatabaseUrl(
        testEnvironment(
          'postgresql://user:secret@127.0.0.1:5432/stack_atlas_prod',
        ),
      ),
    ).toThrow('unsafe database');
  });
});
