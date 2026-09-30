import 'dotenv/config';
import { requirePostgresTestDatabaseUrl } from './postgres-test-safety';

process.env['NODE_ENV'] = 'test';
requirePostgresTestDatabaseUrl();
