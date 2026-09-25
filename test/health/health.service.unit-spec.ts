import { ServiceUnavailableException } from '@nestjs/common';
import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import type { DatabaseService } from '../../src/database/database.service';
import { HealthService } from '../../src/modules/health/services/health.service';

describe('HealthService', () => {
  it('reports ready only after PostgreSQL answers a bounded probe query', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] }),
    } as unknown as Pool;
    const service = new HealthService(pool as unknown as DatabaseService);

    await expect(service.getReadiness()).resolves.toEqual({
      status: 'ok',
      dependencies: { postgres: 'ok' },
    });
    expect(pool.query).toHaveBeenCalledWith('SELECT 1');
  });

  it('returns a generic readiness failure without exposing database errors', async () => {
    const pool = {
      query: vi.fn().mockRejectedValue(new Error('connection secret')),
    } as unknown as Pool;
    const service = new HealthService(pool as unknown as DatabaseService);

    await expect(service.getReadiness()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    await expect(service.getReadiness()).rejects.toThrow(
      'Database is not ready.',
    );
  });
});
