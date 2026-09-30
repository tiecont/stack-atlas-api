import { Pool } from 'pg';
import { runner as runLegacyMigrations } from 'node-pg-migrate';
import { readdir } from 'node:fs/promises';
import { resolve, join, dirname, relative, basename } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { getMigrationDatabaseUrl } from './config.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const compiledModules = resolve(repositoryRoot, 'dist/modules');
const legacyMigrations = resolve(
  repositoryRoot,
  'database/migrations/**/*.{js,cjs}',
);
const historyTable = 'public.stack_atlas_migration_history';
const lockName = 'stack-atlas:api:migration-platform:v1';
const filenamePattern = /^(\d{13})-([A-Z][A-Za-z0-9]*)\.js$/;

export async function migrate(
  direction,
  databaseUrl = getMigrationDatabaseUrl(),
) {
  if (!['up', 'data-up', 'down', 'down-all'].includes(direction)) {
    throw new Error(
      'Migration direction must be up, data-up, down, or down-all.',
    );
  }
  if (!databaseUrl) throw new Error('DATABASE_URL is required to run migrations.');
  await preflightMigration(databaseUrl, direction);

  const pool = new Pool({ connectionString: databaseUrl });
  let lockClient;
  try {
    lockClient = await pool.connect();
    await lockClient.query('SELECT pg_advisory_lock(hashtextextended($1, 0))', [
      lockName,
    ]);
    if (direction === 'up') {
      await runLegacyMigrations({
        databaseUrl,
        dir: legacyMigrations,
        useGlob: true,
        migrationsTable: 'pgmigrations',
        direction: 'up',
        verbose: false,
      });
    }

    await ensureHistoryTable(pool);
    const migrations = await discoverFeatureMigrations();
    await assertHistoryMatchesFiles(pool, migrations);

    if (direction === 'up' || direction === 'data-up') {
      const applied = await readAppliedMigrations(pool);
      const kind = direction === 'up' ? 'schema' : 'data';
      for (const migration of migrations.filter((item) => item.kind === kind)) {
        if (!applied.has(migration.name)) {
          await applyFeatureMigration(pool, migration, 'up');
        }
      }
      return;
    }

    let applied = await readAppliedMigrations(pool);
    const rollbackOrder = getFeatureMigrationsInRollbackOrder(migrations, applied);
    if (direction === 'down-all') {
      for (const migration of rollbackOrder) {
        await applyFeatureMigration(pool, migration, 'down');
      }
    } else {
      const latestApplied = rollbackOrder[0];
      if (latestApplied) {
        await applyFeatureMigration(pool, latestApplied, 'down');
        return;
      }
    }

    await runLegacyMigrations({
      databaseUrl,
      dir: legacyMigrations,
      useGlob: true,
      migrationsTable: 'pgmigrations',
      direction: 'down',
      count: direction === 'down-all' ? 1_000_000 : 1,
      verbose: false,
    });
  } finally {
    try {
      if (lockClient) {
        await lockClient.query(
          'SELECT pg_advisory_unlock(hashtextextended($1, 0))',
          [lockName],
        );
      }
    } finally {
      lockClient?.release();
      await pool.end();
    }
  }
}

export function getFeatureMigrationsInRollbackOrder(migrations, appliedNames) {
  const kindOrder = { data: 0, schema: 1 };
  return migrations
    .filter((migration) => appliedNames.has(migration.name))
    .sort(
      (left, right) =>
        kindOrder[left.kind] - kindOrder[right.kind] ||
        right.timestamp.localeCompare(left.timestamp),
    );
}

export async function preflightMigration(
  databaseUrl = getMigrationDatabaseUrl(),
  direction = 'up',
) {
  if (!databaseUrl) throw new Error('DATABASE_URL is required for migration preflight.');
  if (!['up', 'data-up', 'down', 'down-all'].includes(direction)) {
    throw new Error(
      'Migration preflight direction must be up, data-up, down, or down-all.',
    );
  }

  const migrations = await discoverFeatureMigrations();
  const legacyFiles = await countLegacyMigrationFiles();
  const url = new URL(databaseUrl);
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const database = await pool.query(
      'SELECT current_database() AS database_name, current_user AS database_user',
    );
    const legacyTable = await pool.query(
      "SELECT to_regclass('public.pgmigrations') AS table_name",
    );
    const featureTable = await pool.query(
      `SELECT to_regclass('${historyTable}') AS table_name`,
    );
    const legacyApplied = legacyTable.rows[0]?.table_name
      ? await pool.query('SELECT name FROM public.pgmigrations')
      : { rows: [] };
    const legacyNames = new Set(await listLegacyMigrationNames());
    for (const row of legacyApplied.rows) {
      if (!legacyNames.has(row.name)) {
        throw new Error(
          `Applied legacy migration is missing from source: ${row.name}`,
        );
      }
    }
    const featureApplied = featureTable.rows[0]?.table_name
      ? await pool.query(
          `SELECT migration_name, migration_kind FROM ${historyTable}`,
        )
      : { rows: [] };
    if (featureTable.rows[0]?.table_name) {
      await assertHistoryMatchesFiles(pool, migrations);
    }
    const legacyCount = legacyApplied.rows.length;
    const legacyPending = Math.max(legacyFiles - legacyCount, 0);
    const schemaMigrations = migrations.filter((item) => item.kind === 'schema');
    const dataMigrations = migrations.filter((item) => item.kind === 'data');
    const schemaApplied = featureApplied.rows.filter(
      (row) => row.migration_kind === 'schema',
    ).length;
    const dataApplied = featureApplied.rows.filter(
      (row) => row.migration_kind === 'data',
    ).length;
    const schemaPending = Math.max(schemaMigrations.length - schemaApplied, 0);
    const dataPending = Math.max(dataMigrations.length - dataApplied, 0);
    if (direction === 'data-up' && (legacyPending > 0 || schemaPending > 0)) {
      throw new Error(
        'Apply all legacy and schema migrations before running data migrations.',
      );
    }
    const target = `${url.hostname}${url.port ? `:${url.port}` : ''}/${database.rows[0]?.database_name ?? ''}`;
    const action = direction === 'up'
      ? `${legacyPending} legacy, ${schemaPending} schema, and ${dataPending} data migrations pending`
      : direction === 'data-up'
        ? `${dataPending} data migrations pending after schema readiness`
        : `${schemaApplied} schema, ${dataApplied} data, and ${legacyCount} legacy migrations applied`;
    console.log(`Migration preflight ready for ${target}: ${action}.`);
    return {
      legacyFiles,
      legacyCount,
      schemaFiles: schemaMigrations.length,
      schemaApplied,
      dataFiles: dataMigrations.length,
      dataApplied,
    };
  } finally {
    await pool.end();
  }
}

async function ensureHistoryTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${historyTable} (
      migration_name text PRIMARY KEY,
      migration_kind text NOT NULL CHECK (migration_kind IN ('schema', 'data')),
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

export async function discoverFeatureMigrations() {
  try {
    await readdir(compiledModules);
  } catch {
    throw new Error('Compiled migrations are missing; run npm run build first.');
  }

  const found = [];
  await walk(compiledModules, found);
  found.sort((left, right) => left.timestamp.localeCompare(right.timestamp));
  for (let index = 1; index < found.length; index += 1) {
    if (found[index - 1]?.timestamp === found[index]?.timestamp) {
      throw new Error(`Duplicate migration timestamp: ${found[index]?.timestamp}`);
    }
  }
  return found;
}

export async function countLegacyMigrationFiles() {
  return (await listLegacyMigrationNames()).length;
}

async function listLegacyMigrationNames() {
  const root = resolve(repositoryRoot, 'database/migrations');
  const names = [];
  await collectLegacyMigrationNames(root, names);
  return names;
}

async function collectLegacyMigrationNames(directory, names) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await collectLegacyMigrationNames(path, names);
    } else if (entry.isFile() && /\.(?:cjs|js)$/.test(entry.name)) {
      names.push(basename(entry.name).replace(/\.(?:cjs|js)$/, ''));
    }
  }
}

async function walk(directory, found, migrationKind) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(directory, entry.name);
    const childKind =
      entry.name === 'migrations'
        ? 'schema'
        : entry.name === 'data-migrations'
          ? 'data'
          : migrationKind;
    if (entry.isDirectory()) {
      await walk(path, found, childKind);
      continue;
    }
    if (!entry.isFile() || !migrationKind || !entry.name.endsWith('.js')) {
      continue;
    }
    const match = filenamePattern.exec(entry.name);
    if (!match) {
      throw new Error(`Invalid compiled migration filename: ${path}`);
    }
    const timestamp = match[1];
    const description = match[2];
    if (!timestamp || !description) {
      throw new Error(`Invalid compiled migration filename: ${path}`);
    }
    const module = await import(pathToFileURL(path).href);
    const className = `${description}${timestamp}`;
    const Migration = module[className];
    if (typeof Migration !== 'function') {
      throw new Error(`Migration ${entry.name} must export class ${className}.`);
    }
    found.push({
      name: relative(compiledModules, path).replace(/\.js$/, '.ts'),
      kind: migrationKind,
      timestamp,
      instance: new Migration(),
    });
  }
}

async function assertHistoryMatchesFiles(pool, migrations) {
  const applied = await pool.query(
    `SELECT migration_name, migration_kind FROM ${historyTable}`,
  );
  const available = new Map(
    migrations.map((migration) => [migration.name, migration.kind]),
  );
  for (const row of applied.rows) {
    const availableKind = available.get(row.migration_name);
    if (!availableKind) {
      throw new Error(
        `Applied feature migration is missing from source: ${row.migration_name}`,
      );
    }
    if (availableKind !== row.migration_kind) {
      throw new Error(
        `Applied feature migration changed kind: ${row.migration_name}`,
      );
    }
  }
}

async function readAppliedMigrations(pool) {
  const result = await pool.query(`SELECT migration_name FROM ${historyTable}`);
  return new Set(result.rows.map((row) => row.migration_name));
}

async function applyFeatureMigration(pool, migration, direction) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await migration.instance[direction](client);
    if (direction === 'up') {
      await client.query(
        `INSERT INTO ${historyTable} (migration_name, migration_kind) VALUES ($1, $2)`,
        [migration.name, migration.kind],
      );
    } else {
      await client.query(`DELETE FROM ${historyTable} WHERE migration_name = $1`, [
        migration.name,
      ]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const direction = process.argv[2];
  const preflightDirection = process.argv[3] ?? 'up';
  const hasInvalidArguments = direction === 'preflight'
    ? process.argv.length > 4 || !['up', 'data-up'].includes(preflightDirection)
    : process.argv.length > 3 || !['up', 'data-up', 'down'].includes(direction);
  if (hasInvalidArguments) {
    console.error(
      'Usage: npm run migrate | npm run migration:data-up | npm run migration:down | npm run migration:preflight [up|data-up]',
    );
    process.exitCode = 2;
  } else if (direction === 'preflight') {
    preflightMigration(undefined, preflightDirection)
      .catch((error) => {
        console.error(
          error instanceof Error ? error.message : 'Migration preflight failed.',
        );
        process.exitCode = 1;
      });
  } else {
    migrate(direction)
      .then(() => console.log(`Migration ${direction} complete.`))
      .catch((error) => {
        console.error(
          error instanceof Error ? error.message : 'Migration failed.',
        );
        process.exitCode = 1;
      });
  }
}
