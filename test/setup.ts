import 'reflect-metadata';
import 'dotenv/config';

process.env['NODE_ENV'] = 'test';
process.env['DATABASE_URL'] ??=
  'postgresql://stack_atlas:replace-me@localhost:5432/stack_atlas_test';
process.env['DB_POOL_MAX'] ??= '2';
process.env['CORS_ORIGINS'] ??= 'https://learn.example';
