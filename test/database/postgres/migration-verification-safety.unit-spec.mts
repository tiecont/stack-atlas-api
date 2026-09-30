import { describe, expect, it } from 'vitest';
import { getVerificationAdminUrl } from '../../../scripts/migrations/config.mjs';

const validEnvironment = {
  DATABASE_VERIFY_ADMIN_URL:
    'postgresql://stack_atlas:local@127.0.0.1:5432/postgres',
};

describe('disposable migration verification database safety', () => {
  it('accepts a local PostgreSQL maintenance database', () => {
    expect(getVerificationAdminUrl(validEnvironment)).toBe(
      validEnvironment.DATABASE_VERIFY_ADMIN_URL,
    );
  });

  it('rejects remote hosts and non-maintenance databases', () => {
    expect(() =>
      getVerificationAdminUrl({
        DATABASE_VERIFY_ADMIN_URL:
          'postgresql://stack_atlas:local@db.example.test:5432/postgres',
      }),
    ).toThrow('local PostgreSQL host');
    expect(() =>
      getVerificationAdminUrl({
        DATABASE_VERIFY_ADMIN_URL:
          'postgresql://stack_atlas:local@127.0.0.1:5432/stack_atlas',
      }),
    ).toThrow('maintenance database');
  });
});
