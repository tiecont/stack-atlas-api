import { describe, expect, it } from 'vitest';
import { validateEnvironment } from './environment';

const validValues = {
  DATABASE_URL: 'postgresql://atlas:secret@localhost:5432/atlas',
};

describe('validateEnvironment', () => {
  it('applies safe local defaults and parses the CORS allowlist', () => {
    expect(
      validateEnvironment({
        ...validValues,
        CORS_ORIGINS: 'https://learn.example, http://localhost:8000',
      }),
    ).toMatchObject({
      NODE_ENV: 'development',
      PORT: 3000,
      DB_POOL_MAX: 10,
      CORS_ORIGINS: ['https://learn.example', 'http://localhost:8000'],
    });
  });

  it('rejects missing database configuration before application startup', () => {
    expect(() => validateEnvironment({})).toThrow('DATABASE_URL');
  });

  it('rejects unsafe or malformed CORS origins', () => {
    expect(() =>
      validateEnvironment({ ...validValues, CORS_ORIGINS: '*' }),
    ).toThrow('exact HTTP or HTTPS origins');
  });

  it('rejects invalid database schemes and pool bounds', () => {
    expect(() =>
      validateEnvironment({ DATABASE_URL: 'https://db.example' }),
    ).toThrow('postgres or postgresql scheme');
    expect(() =>
      validateEnvironment({ ...validValues, DB_POOL_MAX: '0' }),
    ).toThrow('DB_POOL_MAX');
  });
});
