import {
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createHash,
  randomBytes,
  randomUUID,
} from 'node:crypto';
import type { Response } from 'express';
import type { Pool, QueryResultRow } from 'pg';
import { DATABASE_POOL } from '../../../database/database.constants';
import { Account } from '../account/account.service';
import { LoginDto } from './authentication.dto';
import { PasswordHasher } from './password-hasher.service';
import {
  SESSION_COOKIE_NAME,
  SESSION_COOKIE_PATH,
  SESSION_TTL_MILLISECONDS,
} from './session.constants';

interface LoginRow extends QueryResultRow {
  id: string;
  email: string;
  password_hash: string;
  created_at: Date | string;
}

const cookieScope = {
  httpOnly: true,
  sameSite: 'lax' as const,
  path: SESSION_COOKIE_PATH,
};

@Injectable()
export class AuthenticationService {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    private readonly passwordHasher: PasswordHasher,
    private readonly config: ConfigService,
  ) {}

  async login(input: LoginDto, response: Response): Promise<Account> {
    const email = input.email.trim().toLowerCase();
    const result = await this.pool.query<LoginRow>(
      `SELECT id, email, password_hash, created_at
       FROM stack_atlas.users
       WHERE email = $1`,
      [email],
    );
    const row = result.rows[0];
    const matches = await this.passwordHasher.verify(
      input.password,
      row?.password_hash ?? null,
    );
    if (!row || !matches) throw new UnauthorizedException();

    const token = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(Date.now() + SESSION_TTL_MILLISECONDS);
    await this.pool.query(
      `INSERT INTO stack_atlas.sessions (id, user_id, token_hash, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [randomUUID(), row.id, tokenHash, expiresAt],
    );

    response.cookie(SESSION_COOKIE_NAME, token, {
      ...cookieScope,
      secure: this.config.getOrThrow<string>('NODE_ENV') === 'production',
      maxAge: SESSION_TTL_MILLISECONDS,
    });
    return {
      id: row.id,
      email: row.email,
      createdAt: new Date(row.created_at).toISOString(),
    };
  }

  async logout(sessionId: string, userId: string): Promise<void> {
    await this.pool.query(
      `UPDATE stack_atlas.sessions
       SET revoked_at = now()
       WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`,
      [sessionId, userId],
    );
  }

  clearCookie(response: Response): void {
    response.clearCookie(SESSION_COOKIE_NAME, {
      ...cookieScope,
      secure: this.config.getOrThrow<string>('NODE_ENV') === 'production',
    });
  }
}
