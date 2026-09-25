import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Request } from 'express';
import type { Pool, QueryResultRow } from 'pg';
import { DATABASE_POOL } from '../../../database/database.constants';
import type { Account } from '../account/account.service';
import { SESSION_COOKIE_NAME } from './session.constants';

interface SessionAccountRow extends QueryResultRow {
  session_id: string;
  id: string;
  email: string;
  created_at: Date | string;
}

export interface AuthenticatedRequest {
  account: Account;
  sessionId: string;
}

export function sessionTokenFromRequest(request: Request): string | null {
  const cookieHeader = request.headers.cookie;
  if (!cookieHeader) return null;
  const prefix = `${SESSION_COOKIE_NAME}=`;
  const entry = cookieHeader.split(';').map((part) => part.trim())
    .find((part) => part.startsWith(prefix));
  if (!entry) return null;
  const token = entry.slice(prefix.length);
  return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
}

@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & AuthenticatedRequest>();
    const token = sessionTokenFromRequest(request);
    if (!token) throw new UnauthorizedException();

    const tokenHash = createHash('sha256').update(token).digest('hex');
    const result = await this.pool.query<SessionAccountRow>(
      `SELECT sessions.id AS session_id, users.id, users.email, users.created_at
       FROM stack_atlas.sessions AS sessions
       JOIN stack_atlas.users AS users ON users.id = sessions.user_id
       WHERE sessions.token_hash = $1
         AND sessions.revoked_at IS NULL
         AND sessions.expires_at > now()`,
      [tokenHash],
    );
    const row = result.rows[0];
    if (!row) throw new UnauthorizedException();

    request.account = {
      id: row.id,
      email: row.email,
      createdAt: new Date(row.created_at).toISOString(),
    };
    request.sessionId = row.session_id;
    return true;
  }
}
