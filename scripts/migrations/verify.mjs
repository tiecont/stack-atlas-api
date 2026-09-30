import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import {
  countLegacyMigrationFiles,
  discoverFeatureMigrations,
  migrate,
} from './runner.mjs';
import { getVerificationAdminUrl } from './config.mjs';

const sourceUrl = getVerificationAdminUrl();
const adminUrl = new URL(sourceUrl);
const databaseName = `stack_atlas_migration_verify_${Date.now()}_${randomBytes(5).toString('hex')}`;
if (!/^stack_atlas_migration_verify_[a-z0-9_]+$/.test(databaseName)) {
  throw new Error('Generated verification database name failed validation.');
}

const adminPool = new Pool({ connectionString: adminUrl.toString() });
let created = false;
try {
  await adminPool.query(`CREATE DATABASE "${databaseName}"`);
  created = true;
  const verificationUrl = new URL(sourceUrl);
  verificationUrl.pathname = `/${databaseName}`;

  const expectedLegacyCount = await countLegacyMigrationFiles();
  const migrations = await discoverFeatureMigrations();
  const expectedSchemaCount = migrations.filter(
    (migration) => migration.kind === 'schema',
  ).length;
  const expectedDataCount = migrations.filter(
    (migration) => migration.kind === 'data',
  ).length;
  await migrate('up', verificationUrl.toString());
  await migrate('data-up', verificationUrl.toString());
  const verifyPool = new Pool({ connectionString: verificationUrl.toString() });
  try {
    const schema = await verifyPool.query(
      "SELECT to_regnamespace('stack_atlas') AS schema_name",
    );
    const legacy = await verifyPool.query(
      'SELECT count(*)::int AS count FROM pgmigrations',
    );
    const feature = await verifyPool.query(
      `SELECT migration_kind, count(*)::int AS count
       FROM public.stack_atlas_migration_history
       GROUP BY migration_kind`,
    );
    const appliedByKind = new Map(
      feature.rows.map((row) => [row.migration_kind, row.count]),
    );
    if (schema.rows[0]?.schema_name !== 'stack_atlas') {
      throw new Error(
        'Migration verification did not create the Stack Atlas schema.',
      );
    }
    if (
      legacy.rows[0]?.count !== expectedLegacyCount ||
      (appliedByKind.get('schema') ?? 0) !== expectedSchemaCount ||
      (appliedByKind.get('data') ?? 0) !== expectedDataCount
    ) {
      throw new Error(
        'Migration verification did not apply every legacy and feature migration.',
      );
    }
  } finally {
    await verifyPool.end();
  }

  await migrate('down-all', verificationUrl.toString());
  const rollbackPool = new Pool({ connectionString: verificationUrl.toString() });
  try {
    const schema = await rollbackPool.query(
      "SELECT to_regnamespace('stack_atlas') AS schema_name",
    );
    const featureHistory = await rollbackPool.query(
      'SELECT count(*)::int AS count FROM public.stack_atlas_migration_history',
    );
    const legacyHistory = await rollbackPool.query(
      'SELECT count(*)::int AS count FROM pgmigrations',
    );
    if (
      schema.rows[0]?.schema_name !== null ||
      featureHistory.rows[0]?.count !== 0 ||
      legacyHistory.rows[0]?.count !== 0
    ) {
      throw new Error(
        'Migration verification did not roll back all feature and legacy migrations.',
      );
    }
  } finally {
    await rollbackPool.end();
  }
  console.log(
    'Legacy, schema, and data migrations apply and roll back in a disposable database.',
  );
} finally {
  if (created) {
    await adminPool.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
  }
  await adminPool.end();
}
