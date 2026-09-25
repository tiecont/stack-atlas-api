import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import type { QueryResultRow } from 'pg';
import { getApplicationConfig } from '../../../../config/application-config';
import { DatabaseService } from '../../../../database/database.service';
import {
  createSessionToken,
  hashSessionToken,
  isSessionToken,
} from '../helpers/session-token';
import type { ActiveSession, CreatedSession } from '../types/session.types';

interface ActiveSessionRow extends QueryResultRow {
  session_id: string;
  account_id: string;
}

@Injectable()
export class SessionService {
  private readonly ttlSeconds: number;

  constructor(
    private readonly database: DatabaseService,
    configService: ConfigService,
  ) {
    this.ttlSeconds = getApplicationConfig(configService).session.ttlSeconds;
  }

  async create(accountId: string): Promise<CreatedSession> {
    const token = createSessionToken();
    const sessionId = randomUUID();
    const result = await this.database.query<{ expires_at: Date | string }>(
      `INSERT INTO stack_atlas.sessions (id, user_id, token_hash, expires_at)
       VALUES ($1, $2, $3, now() + ($4 * interval '1 second'))
       RETURNING expires_at`,
      [sessionId, accountId, hashSessionToken(token), this.ttlSeconds],
    );
    return {
      sessionId,
      accountId,
      token,
      expiresAt: new Date(result.rows[0]!.expires_at).toISOString(),
    };
  }

  async findActiveByToken(token: string): Promise<ActiveSession | null> {
    if (!isSessionToken(token)) return null;
    const result = await this.database.query<ActiveSessionRow>(
      `SELECT id AS session_id, user_id AS account_id
       FROM stack_atlas.sessions
       WHERE token_hash = $1
         AND revoked_at IS NULL
         AND expires_at > now()`,
      [hashSessionToken(token)],
    );
    const row = result.rows[0];
    return row
      ? { sessionId: row.session_id, accountId: row.account_id }
      : null;
  }

  async revoke(sessionId: string, accountId: string): Promise<void> {
    await this.database.query(
      `UPDATE stack_atlas.sessions
       SET revoked_at = now()
       WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`,
      [sessionId, accountId],
    );
  }
}
