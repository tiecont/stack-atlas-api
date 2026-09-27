import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { getApplicationConfig } from '../../../../config/application-config';
import { SessionRepository } from '../repositories/session.repository';
import {
  createSessionToken,
  hashSessionToken,
  isSessionToken,
} from '../helpers/session-token';
import type { ActiveSession, CreatedSession } from '../types/session.types';

/** Owns session credentials and lifecycle policy. */
@Injectable()
export class SessionService {
  private readonly ttlSeconds: number;

  constructor(
    private readonly sessions: SessionRepository,
    configService: ConfigService,
  ) {
    this.ttlSeconds = getApplicationConfig(configService).session.ttlSeconds;
  }

  async create(accountId: string): Promise<CreatedSession> {
    const token = createSessionToken();
    const sessionId = randomUUID();
    const expiresAt = await this.sessions.create(
      sessionId,
      accountId,
      hashSessionToken(token),
      this.ttlSeconds,
    );
    return { sessionId, accountId, token, expiresAt };
  }

  findActiveByToken(token: string): Promise<ActiveSession | null> {
    if (!isSessionToken(token)) return Promise.resolve(null);
    return this.sessions.findActiveByTokenHash(hashSessionToken(token));
  }

  revoke(sessionId: string, accountId: string): Promise<void> {
    return this.sessions.revoke(sessionId, accountId);
  }
}
