import { INestApplication } from '@nestjs/common';
import { randomUUID, createHash } from 'node:crypto';
import { Pool } from 'pg';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { configureHttp } from '../../../src/app.config';
import { AppModule } from '../../../src/app.module';
import { DATABASE_POOL } from '../../../src/database/database.constants';

const databaseUrl = process.env['DATABASE_TEST_URL'];
const integration = describe.skipIf(!databaseUrl);
const allowedOrigin = 'https://learn.example';
const invalidOrigin = 'https://attacker.example';

function responseCookies(response: {
  headers: Record<string, unknown>;
}): string[] {
  const value = response.headers['set-cookie'];
  if (Array.isArray(value))
    return value.filter((item): item is string => typeof item === 'string');
  return typeof value === 'string' ? [value] : [];
}

function publicProblem(
  problem: Record<string, unknown>,
): Record<string, unknown> {
  const publicFields = { ...problem };
  delete publicFields['requestId'];
  return publicFields;
}

integration('identity account and session HTTP contract', () => {
  let app: INestApplication;
  let pool: Pool;
  const originalEnvironment = new Map<string, string | undefined>();
  const setEnvironment = (key: string, value: string) => {
    originalEnvironment.set(key, process.env[key]);
    process.env[key] = value;
  };

  beforeAll(async () => {
    setEnvironment('NODE_ENV', 'test');
    setEnvironment('DATABASE_URL', databaseUrl!);
    setEnvironment('CORS_ORIGINS', allowedOrigin);
    const { runner } = await import('node-pg-migrate');
    await runner({
      databaseUrl: databaseUrl!,
      dir: resolve(process.cwd(), 'database/migrations/**/*.{js,cjs}'),
      useGlob: true,
      migrationsTable: 'pgmigrations',
      direction: 'up',
      verbose: false,
    });
    pool = new Pool({ connectionString: databaseUrl! });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DATABASE_POOL)
      .useValue(pool)
      .compile();
    app = moduleRef.createNestApplication();
    configureHttp(app);
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    for (const [key, value] of originalEnvironment) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('creates an account and enforces the opaque-cookie session lifecycle', async () => {
    const email = `identity-${randomUUID()}@example.test`;
    const password = 'a-test-password-with-enough-length';

    const invalid = await request(app.getHttpServer())
      .post('/api/v1/account')
      .set('Origin', allowedOrigin)
      .send({ email, password, isAdmin: true })
      .expect(400)
      .expect('Content-Type', /application\/problem\+json/);
    expect(invalid.body.status).toBe(400);
    expect(invalid.headers['cache-control']).toBe('no-store');

    await request(app.getHttpServer())
      .post('/api/v1/account')
      .set('Origin', allowedOrigin)
      .send({ email, password: 'too-short' })
      .expect(400)
      .expect('Content-Type', /application\/problem\+json/);

    const created = await request(app.getHttpServer())
      .post('/api/v1/account')
      .set('Origin', allowedOrigin)
      .send({ email: `  ${email.toUpperCase()}  `, password })
      .expect(201)
      .expect('Cache-Control', 'no-store');
    expect(created.body).toMatchObject({ email });
    expect(created.body).not.toHaveProperty('password');
    expect(created.body).not.toHaveProperty('password_hash');

    await request(app.getHttpServer())
      .post('/api/v1/account')
      .set('Origin', allowedOrigin)
      .send({ email, password })
      .expect(409)
      .expect('Content-Type', /application\/problem\+json/);

    const concurrentEmail = `concurrent-${randomUUID()}@example.test`;
    const concurrentCreates = await Promise.all(
      [0, 1].map(() =>
        request(app.getHttpServer())
          .post('/api/v1/account')
          .set('Origin', allowedOrigin)
          .send({ email: concurrentEmail, password }),
      ),
    );
    expect(concurrentCreates.map(({ status }) => status).sort()).toEqual([
      201, 409,
    ]);

    const wrongPassword = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('Origin', allowedOrigin)
      .send({ email, password: 'a-different-password-long-enough' })
      .expect(401)
      .expect('Content-Type', /application\/problem\+json/)
      .expect('Cache-Control', 'no-store');
    const unknownAccount = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('Origin', allowedOrigin)
      .send({ email: 'unknown@example.test', password })
      .expect(401)
      .expect('Content-Type', /application\/problem\+json/);
    expect(publicProblem(wrongPassword.body)).toEqual(
      publicProblem(unknownAccount.body),
    );

    await request(app.getHttpServer())
      .get('/api/v1/account/me')
      .expect(401)
      .expect('Content-Type', /application\/problem\+json/);
    await request(app.getHttpServer())
      .get('/api/v1/account/me')
      .set('Cookie', 'stack_atlas_session=malformed')
      .expect(401);

    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('Origin', allowedOrigin)
      .send({ email: ` ${email.toUpperCase()} `, password })
      .expect(200)
      .expect('Cache-Control', 'no-store')
      .expect('Access-Control-Allow-Origin', allowedOrigin)
      .expect('Access-Control-Allow-Credentials', 'true');
    const setCookies = responseCookies(login);
    const sessionCookie = setCookies.find((cookie) =>
      cookie.startsWith('stack_atlas_session='),
    );
    expect(sessionCookie).toContain('HttpOnly');
    expect(sessionCookie).toContain('SameSite=Lax');
    expect(sessionCookie).toContain('Path=/api/v1');
    expect(sessionCookie).toContain('Max-Age=604800');
    expect(sessionCookie).not.toContain('Secure');
    expect(login.body).not.toHaveProperty('token');
    expect(login.body).not.toHaveProperty('password_hash');

    const token = sessionCookie!
      .split(';', 1)[0]!
      .slice('stack_atlas_session='.length);
    const tokenHash = createHash('sha256').update(token).digest('hex');
    expect(token).not.toBe(tokenHash);
    const storedSession = await pool.query<{ token_hash: string }>(
      `SELECT token_hash FROM stack_atlas.sessions WHERE token_hash = $1`,
      [tokenHash],
    );
    expect(storedSession.rowCount).toBe(1);

    const authenticated = await request(app.getHttpServer())
      .get('/api/v1/account/me')
      .set('Cookie', `stack_atlas_session=${token}`)
      .expect(200)
      .expect('Cache-Control', 'no-store');
    expect(authenticated.body).toEqual(created.body);

    await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Origin', invalidOrigin)
      .set('Cookie', `stack_atlas_session=${token}`)
      .expect(403);
    await request(app.getHttpServer())
      .get('/api/v1/account/me')
      .set('Cookie', `stack_atlas_session=${token}`)
      .expect(200);

    const logout = await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Origin', allowedOrigin)
      .set('Cookie', `stack_atlas_session=${token}`)
      .expect(204)
      .expect('Cache-Control', 'no-store');
    expect(responseCookies(logout).join(';')).toContain(
      'stack_atlas_session=;',
    );
    await request(app.getHttpServer())
      .get('/api/v1/account/me')
      .set('Cookie', `stack_atlas_session=${token}`)
      .expect(401);

    const secondLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('Origin', allowedOrigin)
      .send({ email, password })
      .expect(200);
    const secondCookie = responseCookies(secondLogin)
      .find((cookie) => cookie.startsWith('stack_atlas_session='))!
      .split(';', 1)[0]!
      .slice('stack_atlas_session='.length);
    const secondHash = createHash('sha256').update(secondCookie).digest('hex');
    await pool.query(
      `UPDATE stack_atlas.sessions
       SET created_at = now() - interval '2 seconds',
           expires_at = now() - interval '1 second'
       WHERE token_hash = $1`,
      [secondHash],
    );
    await request(app.getHttpServer())
      .get('/api/v1/account/me')
      .set('Cookie', `stack_atlas_session=${secondCookie}`)
      .expect(401);
  }, 30_000);
});
