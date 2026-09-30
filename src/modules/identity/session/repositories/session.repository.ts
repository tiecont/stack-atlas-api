import { Injectable } from '@nestjs/common';
import type { QueryResultRow } from 'pg';
import { DatabaseService } from '../../../../database/database.service';
import type { ActiveSession } from '../types/session.types';

interface ActiveSessionRow extends QueryResultRow {
  session_id: string;
  account_id: string;
}

/** Owns session SQL and maps rows to the session feature contract. */
@Injectable()
export class SessionRepository {
  constructor(private readonly database: DatabaseService) {}

  async create(
    sessionId: string,
    accountId: string,
    tokenHash: string,
    ttlSeconds: number,
  ): Promise<string> {
    const result = await this.database.query<{ expires_at: Date | string }>(
      `INSERT INTO stack_atlas.sessions (id, user_id, token_hash, expires_at)
       VALUES ($1, $2, $3, now() + ($4 * interval '1 second'))
       RETURNING expires_at`,
      [sessionId, accountId, tokenHash, ttlSeconds],
    );
    const row = result.rows[0];
    if (!row) throw new Error('Session insert did not return its expiry.');
    return new Date(row.expires_at).toISOString();
  }

  async findActiveByTokenHash(
    tokenHash: string,
  ): Promise<ActiveSession | null> {
    const result = await this.database.query<ActiveSessionRow>(
      `SELECT id AS session_id, user_id AS account_id
       FROM stack_atlas.sessions
       WHERE token_hash = $1
         AND revoked_at IS NULL
         AND expires_at > now()`,
      [tokenHash],
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
