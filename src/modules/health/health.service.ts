import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { Pool } from 'pg';
import { DATABASE_POOL } from '../../database/database.constants';

@Injectable()
export class HealthService {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async getReadiness(): Promise<{
    status: 'ok';
    dependencies: { postgres: 'ok' };
  }> {
    try {
      await this.pool.query('SELECT 1');
    } catch {
      throw new ServiceUnavailableException('Database is not ready.');
    }

    return { status: 'ok', dependencies: { postgres: 'ok' } };
  }
}
