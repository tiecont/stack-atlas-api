import { Injectable } from '@nestjs/common';
import type { QueryResultRow } from 'pg';
import { DatabaseService } from '../../../../database/database.service';
import type { Account, AccountCredentials } from '../types/account.types';

interface AccountRow extends QueryResultRow {
  id: string;
  email: string;
  created_at: Date | string;
}

interface CredentialAccountRow extends AccountRow {
  password_hash: string;
}

/** Owns account SQL and maps database rows into the account feature contract. */
@Injectable()
export class AccountRepository {
  constructor(private readonly database: DatabaseService) {}

  async create(
    accountId: string,
    email: string,
    passwordHash: string,
  ): Promise<Account> {
    const result = await this.database.query<AccountRow>(
      `INSERT INTO stack_atlas.users (id, email, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, email, created_at`,
      [accountId, email, passwordHash],
    );
    return toAccount(result.rows[0]!);
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

  async findCredentialsByEmail(
    normalizedEmail: string,
  ): Promise<AccountCredentials | null> {
    const result = await this.database.query<CredentialAccountRow>(
      `SELECT id, email, created_at, password_hash
       FROM stack_atlas.users
       WHERE email = $1`,
      [normalizedEmail],
    );
    const row = result.rows[0];
    return row
      ? { account: toAccount(row), passwordHash: row.password_hash }
      : null;
  }
}

function toAccount(row: AccountRow): Account {
  return {
    id: row.id,
    email: row.email,
    createdAt: new Date(row.created_at).toISOString(),
  };
}
