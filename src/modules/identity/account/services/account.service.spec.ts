import { ConflictException } from '@nestjs/common';
import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { DatabaseService } from '../../../../database/database.service';
import { AccountRepository } from '../repositories/account.repository';
import { AccountService } from './account.service';
import type { PasswordHasher } from './password-hasher.service';

const accountRow = {
  id: '4aa6cf31-06cf-4422-a9b3-c508f71ef6f5',
  email: 'reader@example.test',
  created_at: new Date('2026-09-27T00:00:00.000Z'),
};

function createService(
  query = vi.fn().mockResolvedValue({ rows: [accountRow] }),
) {
  const pool = { query } as unknown as Pool;
  const accounts = new AccountRepository(new DatabaseService(pool));
  const passwordHasher: PasswordHasher = {
    hash: vi.fn(async () => 'hashed-password'),
    verify: vi.fn(async () => true),
  };
  return {
    query,
    passwordHasher,
    service: new AccountService(accounts, passwordHasher),
  };
}

describe('AccountService', () => {
  it('normalizes email and hashes the password before account insertion', async () => {
    const { query, passwordHasher, service } = createService();

    await expect(
      service.create({
        email: '  READER@Example.Test  ',
        password: 'a-long-enough-password',
      }),
    ).resolves.toEqual({
      id: accountRow.id,
      email: accountRow.email,
      createdAt: accountRow.created_at.toISOString(),
    });

    expect(passwordHasher.hash).toHaveBeenCalledWith('a-long-enough-password');
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO stack_atlas.users'),
      [expect.any(String), 'reader@example.test', 'hashed-password'],
    );
  });

  it('normalizes credential lookups consistently with registration', async () => {
    const credentialRow = { ...accountRow, password_hash: 'stored-hash' };
    const query = vi.fn().mockResolvedValue({ rows: [credentialRow] });
    const { service } = createService(query);

    await expect(
      service.findForAuthentication(' Reader@Example.Test '),
    ).resolves.toEqual({
      account: {
        id: accountRow.id,
        email: accountRow.email,
        createdAt: accountRow.created_at.toISOString(),
      },
      passwordHash: 'stored-hash',
    });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('WHERE email = $1'),
      ['reader@example.test'],
    );
  });

  it('maps only the email unique constraint to a safe conflict response', async () => {
    const query = vi.fn().mockRejectedValue({
      code: '23505',
      constraint: 'users_email_key',
      detail: 'sensitive database detail',
    });
    const { service } = createService(query);

    const error = await service
      .create({
        email: 'reader@example.test',
        password: 'a-long-enough-password',
      })
      .then(
        () => null,
        (reason: unknown) => reason,
      );

    expect(error).toBeInstanceOf(ConflictException);
    if (error instanceof ConflictException) {
      expect(JSON.stringify(error.getResponse())).not.toContain(
        'sensitive database detail',
      );
    }
  });
});
