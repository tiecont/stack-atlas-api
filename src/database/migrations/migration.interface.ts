import type { PoolClient } from 'pg';

export interface MigrationInterface {
  up(queryRunner: PoolClient): Promise<void>;
  down(queryRunner: PoolClient): Promise<void>;
}
