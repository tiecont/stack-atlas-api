import { ConflictException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { QueryResultRow } from 'pg';
import { DatabaseService } from '../../../../database/database.service';
import { PasswordHasher } from './password-hasher.service';
import { CreateAccountDto } from '../dto/account.dto';

interface AccountRow extends QueryResultRow {
  id: string;
  email: string;
  created_at: Date | string;
}

interface CredentialAccountRow extends AccountRow {
  password_hash: string;
}

export interface Account {
  id: string;
  email: string;
  createdAt: string;
}

export interface AccountCredentials {
  account: Account;
  passwordHash: string;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function toAccount(row: AccountRow): Account {
  return {
    id: row.id,
    email: row.email,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

@Injectable()
export class AccountService {
  constructor(
    private readonly database: DatabaseService,
    private readonly passwordHasher: PasswordHasher,
  ) {}

  async create(input: CreateAccountDto): Promise<Account> {
    const email = normalizeEmail(input.email);
    const passwordHash = await this.passwordHasher.hash(input.password);
    try {
      const result = await this.database.query<AccountRow>(
        `INSERT INTO stack_atlas.users (id, email, password_hash)
         VALUES ($1, $2, $3)
         RETURNING id, email, created_at`,
        [randomUUID(), email, passwordHash],
      );
      return toAccount(result.rows[0]!);
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === '23505' &&
        'constraint' in error &&
        error.constraint === 'users_email_key'
      ) {
        throw new ConflictException(
          'An account with this email already exists.',
        );
      }
      throw error;
    }
  }

  async findById(accountId: string): Promise<Account | null> {
    const result = await this.database.query<AccountRow>(
      `SELECT id, email, created_at
       FROM stack_atlas.users
       WHERE id = $1`,
      [accountId],
    );
    const row = result.rows[0];
    return row ? toAccount(row) : null;
  }

  async findForAuthentication(
    email: string,
  ): Promise<AccountCredentials | null> {
    const result = await this.database.query<CredentialAccountRow>(
      `SELECT id, email, created_at, password_hash
       FROM stack_atlas.users
       WHERE email = $1`,
      [normalizeEmail(email)],
    );
    const row = result.rows[0];
    return row
      ? { account: toAccount(row), passwordHash: row.password_hash }
      : null;
  }
}
