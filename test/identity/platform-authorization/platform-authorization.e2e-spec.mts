import { Body, Controller, Module, Post, Req, UseGuards } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Request } from 'express';
import { Pool } from 'pg';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { configureHttp } from '../../../src/app.config.js';
import { AppModule } from '../../../src/app.module.js';
import { DATABASE_POOL } from '../../../src/database/database.constants.js';
import { AccountModule } from '../../../src/modules/identity/account/account.module.js';
import { SessionModule } from '../../../src/modules/identity/session/session.module.js';
import { PlatformAuthorizationModule } from '../../../src/modules/identity/platform-authorization/platform-authorization.module.js';
import { PLATFORM_PERMISSION } from '../../../src/modules/identity/platform-authorization/constants/platform-permissions.js';
import { PermissionGuard } from '../../../src/modules/identity/platform-authorization/guards/permission.guard.js';
import { RequirePermissions } from '../../../src/modules/identity/platform-authorization/guards/require-permissions.js';
import { PlatformAuthorizationService } from '../../../src/modules/identity/platform-authorization/services/platform-authorization.service.js';
import { SessionAuthGuard } from '../../../src/modules/identity/authentication/guards/session-auth.guard.js';
import type { AuthenticatedRequest } from '../../../src/modules/identity/authentication/guards/session-auth.guard.js';
import { migrate } from '../../../scripts/migrations/runner.mjs';
import { requirePostgresTestDatabaseUrl } from '../../postgres-test-safety.js';

const databaseUrl = requirePostgresTestDatabaseUrl();
const allowedOrigin = 'https://learn.example';

@Controller('__test/platform-authorization')
class PlatformAuthorizationProbeController {
  @Post('content')
  @UseGuards(SessionAuthGuard, PermissionGuard)
  @RequirePermissions(PLATFORM_PERMISSION.CONTENT_READ)
  read(
    @Req() request_: Request & AuthenticatedRequest,
    @Body() body: { accountId?: string },
  ) {
    return {
      accountId: request_.principal.accountId,
      requestedAccountId: body.accountId ?? null,
    };
  }
}

@Module({
  imports: [
    AppModule,
    AccountModule,
    SessionModule,
    PlatformAuthorizationModule,
  ],
  controllers: [PlatformAuthorizationProbeController],
})
class PlatformAuthorizationE2eModule {}

function responseCookies(response: {
  headers: Record<string, unknown>;
}): string[] {
  const value = response.headers['set-cookie'];
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string');
  }
  return typeof value === 'string' ? [value] : [];
}

async function createAccountAndLogin(app: INestApplication, label: string) {
  const email = `${label}-${randomUUID()}@example.test`;
  const password = 'a-test-password-with-enough-length';
  const created = await request(app.getHttpServer())
    .post('/api/v1/account')
    .set('Origin', allowedOrigin)
    .send({ email, password })
    .expect(201);
  const login = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .set('Origin', allowedOrigin)
    .send({ email, password })
    .expect(200);
  const cookie = responseCookies(login).find((item) =>
    item.startsWith('stack_atlas_session='),
  );
  if (!cookie) throw new Error('Login did not issue the session cookie.');
  return {
    account: created.body as { id: string; email: string },
    cookie: cookie.split(';', 1)[0]!,
  };
}

describe('platform authorization HTTP boundary', () => {
  let app: INestApplication;
  let pool: Pool;

  beforeAll(async () => {
    process.env['NODE_ENV'] = 'test';
    process.env['DATABASE_URL'] = databaseUrl;
    process.env['CORS_ORIGINS'] = allowedOrigin;
    await migrate('up', databaseUrl);
    await migrate('data-up', databaseUrl);
    pool = new Pool({ connectionString: databaseUrl });
    const moduleRef = await Test.createTestingModule({
      imports: [PlatformAuthorizationE2eModule],
    })
      .overrideProvider(DATABASE_POOL)
      .useValue(pool)
      .compile();
    app = moduleRef.createNestApplication();
    configureHttp(app);
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('distinguishes missing sessions, forbidden actors, allowed actors, and live revocation', async () => {
    const probe = '/api/v1/__test/platform-authorization/content';
    await request(app.getHttpServer())
      .post(probe)
      .send({ accountId: randomUUID() })
      .expect(401);

    const platformAdmin = await createAccountAndLogin(app, 'platform-admin');
    const unprivileged = await createAccountAndLogin(app, 'unprivileged');

    await request(app.getHttpServer())
      .post(probe)
      .set('Cookie', unprivileged.cookie)
      .send({ accountId: platformAdmin.account.id })
      .expect(403);

    const authorization = app.get(PlatformAuthorizationService);
    await authorization.changeRoleAssignment(
      platformAdmin.account.id,
      'content-editor',
      true,
    );
    const allowed = await request(app.getHttpServer())
      .post(probe)
      .set('Cookie', platformAdmin.cookie)
      .send({ accountId: unprivileged.account.id })
      .expect(201);
    expect(allowed.body).toEqual({
      accountId: platformAdmin.account.id,
      requestedAccountId: unprivileged.account.id,
    });

    await authorization.changeRoleAssignment(
      platformAdmin.account.id,
      'content-editor',
      false,
    );
    await request(app.getHttpServer())
      .post(probe)
      .set('Cookie', platformAdmin.cookie)
      .send({ accountId: platformAdmin.account.id })
      .expect(403);

    await authorization.changeRoleAssignment(
      platformAdmin.account.id,
      'content-editor',
      true,
    );
    await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Origin', allowedOrigin)
      .set('Cookie', platformAdmin.cookie)
      .send({})
      .expect(204);
    await request(app.getHttpServer())
      .post(probe)
      .set('Cookie', platformAdmin.cookie)
      .send({ accountId: platformAdmin.account.id })
      .expect(401);
  }, 30_000);
});
