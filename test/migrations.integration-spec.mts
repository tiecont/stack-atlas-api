import { Pool } from 'pg';
import { runner } from 'node-pg-migrate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolve } from 'node:path';

const databaseUrl = process.env['DATABASE_TEST_URL'];
const integration = describe.skipIf(!databaseUrl);
let pool: Pool | undefined;

integration('PostgreSQL migrations', () => {
  const runMigrations = (direction: 'up' | 'down') =>
    runner({
      databaseUrl: databaseUrl!,
      dir: resolve(process.cwd(), 'database/migrations'),
      migrationsTable: 'pgmigrations',
      direction,
      verbose: false,
    });

  beforeAll(async () => {
    await runMigrations('up');
    pool = new Pool({ connectionString: databaseUrl! });
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('creates the owned Stack Atlas schema and records the timestamped migration', async () => {
    const schema = await pool!.query(
      "SELECT to_regnamespace('stack_atlas') AS schema_name",
    );
    const history = await pool!.query(
      "SELECT name FROM pgmigrations WHERE name = '20260924072735_create_stack_atlas_schema'",
    );

    expect(schema.rows[0]?.schema_name).toBe('stack_atlas');
    expect(history.rowCount).toBe(1);
    const identityTables = await pool!.query(
      `SELECT count(*)::int AS count
       FROM information_schema.tables
       WHERE table_schema = 'stack_atlas'
         AND table_name IN ('users', 'sessions')`,
    );
    expect(identityTables.rows[0]?.count).toBe(2);
  });

  it('refuses to roll back a foundation schema after it contains objects', async () => {
    await pool!.query('CREATE TABLE stack_atlas.migration_safety_probe (id integer)');
    await runMigrations('down');
    await expect(runMigrations('down')).rejects.toThrow(
      'Refusing to drop the non-empty stack_atlas schema',
    );
    await pool!.query('DROP TABLE stack_atlas.migration_safety_probe');
  });

  it('can roll back the empty schema in the disposable local test database', async () => {
    await runMigrations('down');
    const schema = await pool!.query(
      "SELECT to_regnamespace('stack_atlas') AS schema_name",
    );
    expect(schema.rows[0]?.schema_name).toBeNull();
  });
});
