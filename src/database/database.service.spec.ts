import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { DatabaseService } from './database.service';

function createDatabase() {
  const client = {
    query: vi.fn().mockResolvedValue({ rows: [] }),
    release: vi.fn(),
  };
  const pool = {
    query: vi.fn().mockResolvedValue({ rows: [{ value: 1 }] }),
    connect: vi.fn(async () => client),
    end: vi.fn(async () => undefined),
  } as unknown as Pool;
  return { client, pool, service: new DatabaseService(pool) };
}

describe('DatabaseService', () => {
  it('delegates queries and closes its canonical pool on shutdown', async () => {
    const { pool, service } = createDatabase();

    await expect(service.query('SELECT $1', [1])).resolves.toMatchObject({
      rows: [{ value: 1 }],
    });
    expect(pool.query).toHaveBeenCalledWith('SELECT $1', [1]);
    await service.onApplicationShutdown();
    expect(pool.end).toHaveBeenCalledOnce();
  });

  it('commits successful transaction work and always releases its client', async () => {
    const { client, service } = createDatabase();

    await expect(
      service.transaction(async (transaction) => {
        await transaction.query('SELECT 1');
        return 'committed';
      }),
    ).resolves.toBe('committed');
    expect(client.query.mock.calls.map(([sql]) => sql)).toEqual([
      'BEGIN',
      'SELECT 1',
      'COMMIT',
    ]);
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('rolls back operation errors and rethrows the original error', async () => {
    const { client, service } = createDatabase();
    const operationError = new Error('operation failed');

    await expect(
      service.transaction(async () => {
        throw operationError;
      }),
    ).rejects.toBe(operationError);
    expect(client.query.mock.calls.map(([sql]) => sql)).toEqual([
      'BEGIN',
      'ROLLBACK',
    ]);
    expect(client.release).toHaveBeenCalledOnce();
  });
});
