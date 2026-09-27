import { ConfigService } from '@nestjs/config';
import type { Pool } from 'pg';
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { DatabaseService } from '../../../src/database/database.service';
import { SessionRepository } from '../../../src/modules/identity/session/repositories/session.repository';
import { SessionService } from '../../../src/modules/identity/session/services/session.service';

const expiration = '2026-10-04T00:00:00.000Z';
const activeSessionRow = {
  session_id: '60b2393d-543d-4f30-b7de-13905c51af30',
  account_id: '4aa6cf31-06cf-4422-a9b3-c508f71ef6f5',
};

function createService() {
  const query = vi.fn().mockImplementation(async (statement: string) => {
    if (statement.includes('INSERT INTO stack_atlas.sessions')) {
      return { rows: [{ expires_at: expiration }] };
    }
    if (statement.includes('SELECT id AS session_id')) {
      return { rows: [activeSessionRow] };
    }
    return { rows: [] };
  });
  const pool = { query } as unknown as Pool;
  const sessions = new SessionRepository(new DatabaseService(pool));
  const config = new ConfigService({
    application: { session: { ttlSeconds: 604_800 } },
  });
  return { query, service: new SessionService(sessions, config) };
}

describe('SessionService', () => {
  it('creates a random token and persists only its digest with the configured TTL', async () => {
    const { query, service } = createService();
    const accountId = activeSessionRow.account_id;
    const created = await service.create(accountId);
    const expectedHash = createHash('sha256')
      .update(created.token)
      .digest('hex');

    expect(created).toMatchObject({ accountId, expiresAt: expiration });
    expect(created.sessionId).toEqual(expect.any(String));
    expect(created.token).not.toBe(expectedHash);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO stack_atlas.sessions'),
      [created.sessionId, accountId, expectedHash, 604_800],
    );
  });

  it('hashes a well-formed token for active lookup and skips malformed tokens', async () => {
    const { query, service } = createService();
    const token = 'a'.repeat(43);
    const tokenHash = createHash('sha256').update(token).digest('hex');

    await expect(service.findActiveByToken(token)).resolves.toEqual({
      sessionId: activeSessionRow.session_id,
      accountId: activeSessionRow.account_id,
    });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('WHERE token_hash = $1'),
      [tokenHash],
    );
    await expect(service.findActiveByToken('malformed')).resolves.toBeNull();
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('delegates idempotent revocation to the session repository', async () => {
    const { query, service } = createService();

    await service.revoke(
      activeSessionRow.session_id,
      activeSessionRow.account_id,
    );

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('SET revoked_at = now()'),
      [activeSessionRow.session_id, activeSessionRow.account_id],
    );
    expect(query.mock.calls[0]?.[0]).toContain('revoked_at IS NULL');
  });
});
