import { ConflictException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { CreateAccountDto } from '../dto/account.dto';
import { AccountRepository } from '../repositories/account.repository';
import type { Account, AccountCredentials } from '../types/account.types';
import { PasswordHasher } from './password-hasher.service';

/** Applies registration policy and coordinates account persistence. */
@Injectable()
export class AccountService {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly passwordHasher: PasswordHasher,
  ) {}

  async create(input: CreateAccountDto): Promise<Account> {
    const email = normalizeEmail(input.email);
    const passwordHash = await this.passwordHasher.hash(input.password);
    try {
      return await this.accounts.create(randomUUID(), email, passwordHash);
    } catch (error) {
      if (isEmailUniqueViolation(error)) {
        throw new ConflictException(
          'An account with this email already exists.',
        );
      }
      throw error;
    }
  }

  findById(accountId: string): Promise<Account | null> {
    return this.accounts.findById(accountId);
  }

  findForAuthentication(email: string): Promise<AccountCredentials | null> {
    return this.accounts.findCredentialsByEmail(normalizeEmail(email));
  }
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isEmailUniqueViolation(
  error: unknown,
): error is { code: string; constraint: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === '23505' &&
    'constraint' in error &&
    error.constraint === 'users_email_key'
  );
}
