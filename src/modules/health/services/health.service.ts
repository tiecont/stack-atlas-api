import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { DatabaseService } from '../../../database/database.service';

/** Implements the PostgreSQL-backed readiness probe. */
@Injectable()
export class HealthService {
  constructor(private readonly database: DatabaseService) {}

  /** Checks the live database connection without returning connection details. */
  async getReadiness(): Promise<{
    status: 'ok';
    dependencies: { postgres: 'ok' };
  }> {
    try {
      await this.database.query('SELECT 1');
    } catch {
      throw new ServiceUnavailableException('Database is not ready.');
    }

    return { status: 'ok', dependencies: { postgres: 'ok' } };
  }
}
