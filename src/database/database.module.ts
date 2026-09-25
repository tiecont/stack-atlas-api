import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { getApplicationConfig } from '../config/application-config';
import { DATABASE_POOL } from './database.constants';
import { DatabaseService } from './database.service';

const logger = new Logger('DatabasePool');

@Module({
  providers: [
    {
      provide: DATABASE_POOL,
      inject: [ConfigService],
      useFactory: (configService: ConfigService): Pool => {
        const config = getApplicationConfig(configService);
        const pool = new Pool({
          connectionString: config.database.url,
          max: config.database.poolMax,
          connectionTimeoutMillis: 3_000,
          idleTimeoutMillis: 30_000,
          statement_timeout: 3_000,
          application_name: 'stack-atlas-api',
        });
        pool.on('error', () => {
          logger.error('An idle PostgreSQL client reported an error.');
        });
        return pool;
      },
    },
    DatabaseService,
  ],
  exports: [DATABASE_POOL, DatabaseService],
})
export class DatabaseModule {}
