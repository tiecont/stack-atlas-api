import { describe, expect, it } from 'vitest';
import { validateEnvironment } from '../../../src/config/environment';

const validValues = {
  DATABASE_URL: 'postgresql://atlas:secret@localhost:5432/atlas',
};

describe('validateEnvironment', () => {
  it('applies documented local defaults and returns typed configuration', () => {
    expect(validateEnvironment(validValues)).toMatchObject({
      application: {
        environment: 'development',
        port: 3000,
        database: { url: validValues.DATABASE_URL, poolMax: 10 },
        http: {
          apiPrefix: 'api/v1',
          corsOrigins: ['http://localhost:3001'],
        },
        session: {
          cookieName: 'stack_atlas_session',
          cookiePath: '/api/v1',
          ttlSeconds: 604_800,
          secure: false,
        },
      },
    });
  });

  it('requires a database URL with a PostgreSQL scheme, host, and database', () => {
    expect(() => validateEnvironment({})).toThrow('DATABASE_URL');
    expect(() =>
      validateEnvironment({ DATABASE_URL: 'https://db.example/atlas' }),
    ).toThrow('PostgreSQL URL');
    expect(() =>
      validateEnvironment({ DATABASE_URL: 'postgresql://localhost' }),
    ).toThrow('host and database name');
  });

  it('rejects malformed integer settings and out-of-range session duration', () => {
    for (const PORT of ['0', '65536', '3.2', '1e3']) {
      expect(() => validateEnvironment({ ...validValues, PORT })).toThrow(
        'PORT',
      );
    }
    expect(() =>
      validateEnvironment({ ...validValues, DB_POOL_MAX: '101' }),
    ).toThrow('DB_POOL_MAX');
    expect(() =>
      validateEnvironment({ ...validValues, SESSION_TTL_SECONDS: '0' }),
    ).toThrow('SESSION_TTL_SECONDS');
    expect(() =>
      validateEnvironment({ ...validValues, SESSION_TTL_SECONDS: '2592001' }),
    ).toThrow('SESSION_TTL_SECONDS');
  });

  it('requires exact origins and HTTPS origins in production', () => {
    expect(() =>
      validateEnvironment({ ...validValues, CORS_ORIGINS: '*' }),
    ).toThrow('exact HTTP or HTTPS origins');
    expect(() =>
      validateEnvironment({
        ...validValues,
        NODE_ENV: 'production',
        CORS_ORIGINS: 'http://learn.example',
      }),
    ).toThrow('HTTPS in production');
    expect(
      validateEnvironment({
        ...validValues,
        NODE_ENV: 'production',
        CORS_ORIGINS: 'https://learn.example',
      }).application,
    ).toMatchObject({ session: { secure: true } });
  });

  it('allows an explicitly empty CORS allowlist and rejects invalid cookie names', () => {
    expect(
      validateEnvironment({ ...validValues, CORS_ORIGINS: '' }).application,
    ).toMatchObject({ http: { corsOrigins: [] } });
    expect(() =>
      validateEnvironment({ ...validValues, SESSION_COOKIE_NAME: 'bad name' }),
    ).toThrow('SESSION_COOKIE_NAME');
  });
});
