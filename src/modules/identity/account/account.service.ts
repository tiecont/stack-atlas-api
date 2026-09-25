import {
  ConflictException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Pool, QueryResultRow } from 'pg';
import { DATABASE_POOL } from '../../../database/database.constants';
import { PasswordHasher } from '../authentication/password-hasher.service';
import { CreateAccountDto } from './account.dto';

interface AccountRow extends QueryResultRow {
  id: string;
  email: string;
  created_at: Date | string;
}

export interface Account {
  id: string;
  email: string;
  createdAt: string;
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
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    private readonly passwordHasher: PasswordHasher,
  ) {}

  async create(input: CreateAccountDto): Promise<Account> {
    const email = input.email.trim().toLowerCase();
    const passwordHash = await this.passwordHasher.hash(input.password);
    try {
      const result = await this.pool.query<AccountRow>(
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
        error.code === '23505'
      ) {
        throw new ConflictException('An account with this email already exists.');
      }
      throw error;
    }
  }
}
