import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import express from 'express';
import type { Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { AuthenticationService } from './authentication.service';
import type { AccountCredentials } from '../../account/types/account.types';
import { AccountService } from '../../account/services/account.service';
import { PasswordHasher } from '../../account/services/password-hasher.service';
import { SessionService } from '../../session/services/session.service';

const account = {
  id: '4aa6cf31-06cf-4422-a9b3-c508f71ef6f5',
  email: 'reader@example.test',
  createdAt: '2026-09-27T00:00:00.000Z',
};

function createResponse(): Response {
  const response = Object.create(express.response) as Response;
  vi.spyOn(response, 'cookie').mockReturnThis();
  vi.spyOn(response, 'clearCookie').mockReturnThis();
  return response;
}

function createService(
  credentials: AccountCredentials | null = {
    account,
    passwordHash: 'stored-password-hash',
  },
  passwordMatches = true,
) {
  const accounts = {
    findForAuthentication: vi.fn(async () => credentials),
  };
  const passwordHasher = {
    verify: vi.fn(async () => passwordMatches),
  };
  const sessions = {
    create: vi.fn(async () => ({
      sessionId: 'session-id',
      accountId: account.id,
      token: 'opaque-session-token',
      expiresAt: '2026-10-04T00:00:00.000Z',
    })),
    revoke: vi.fn(async () => undefined),
  };
  const config = new ConfigService({
    application: {
      environment: 'test',
      port: 3000,
      database: { url: 'postgresql://localhost/stack_atlas_test', poolMax: 2 },
      http: { apiPrefix: '/api/v1', corsOrigins: [] },
      session: {
        cookieName: 'atlas_session',
        cookiePath: '/api/v1',
        ttlSeconds: 604_800,
        secure: false,
      },
    },
  });

  return Test.createTestingModule({
    providers: [
      AuthenticationService,
      { provide: AccountService, useValue: accounts },
      { provide: PasswordHasher, useValue: passwordHasher },
      { provide: SessionService, useValue: sessions },
      { provide: ConfigService, useValue: config },
    ],
  })
    .compile()
    .then((moduleRef) => ({
      accounts,
      passwordHasher,
      sessions,
      service: moduleRef.get(AuthenticationService),
    }));
}

describe('AuthenticationService', () => {
  it('checks credentials before creating a session and sets the opaque cookie', async () => {
    const { accounts, passwordHasher, sessions, service } =
      await createService();
    const response = createResponse();

    await expect(
      service.login(
        { email: ' READER@example.test ', password: 'correct-password' },
        response,
      ),
    ).resolves.toEqual(account);

    expect(accounts.findForAuthentication).toHaveBeenCalledWith(
      ' READER@example.test ',
    );
    expect(passwordHasher.verify).toHaveBeenCalledWith(
      'correct-password',
      'stored-password-hash',
    );
    expect(sessions.create).toHaveBeenCalledWith(account.id);
    expect(response.cookie).toHaveBeenCalledWith(
      'atlas_session',
      'opaque-session-token',
      {
        httpOnly: true,
        sameSite: 'lax',
        path: '/api/v1',
        secure: false,
        maxAge: 604_800_000,
      },
    );
  });

  it('rejects a password mismatch without creating a session or cookie', async () => {
    const { sessions, service } = await createService(undefined, false);
    const response = createResponse();

    await expect(
      service.login(
        { email: account.email, password: 'wrong-password' },
        response,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(sessions.create).not.toHaveBeenCalled();
    expect(response.cookie).not.toHaveBeenCalled();
  });

  it('uses the same unauthorized response when the account does not exist', async () => {
    const { passwordHasher, sessions, service } = await createService(null);
    const response = createResponse();

    await expect(
      service.login(
        { email: 'missing@example.test', password: 'wrong-password' },
        response,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(passwordHasher.verify).toHaveBeenCalledWith('wrong-password', null);
    expect(sessions.create).not.toHaveBeenCalled();
    expect(response.cookie).not.toHaveBeenCalled();
  });

  it('delegates logout revocation and clears the matching session cookie', async () => {
    const { sessions, service } = await createService();
    const response = createResponse();

    await service.logout('session-id', account.id);
    service.clearCookie(response);

    expect(sessions.revoke).toHaveBeenCalledWith('session-id', account.id);
    expect(response.clearCookie).toHaveBeenCalledWith('atlas_session', {
      httpOnly: true,
      sameSite: 'lax',
      path: '/api/v1',
      secure: false,
    });
  });
});
