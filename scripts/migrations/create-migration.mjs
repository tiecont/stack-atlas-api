import { spawnSync } from 'node:child_process';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { resolve, join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const [context, feature, description, ...extra] = process.argv.slice(2);
const segmentPattern = /^[a-z][a-z0-9-]*$/;
const descriptionPattern = /^[A-Z][A-Za-z0-9]*$/;

if (
  !context ||
  !feature ||
  !description ||
  extra.length > 0 ||
  !segmentPattern.test(context) ||
  !segmentPattern.test(feature) ||
  !descriptionPattern.test(description)
) {
  console.error(
    'Usage: npm run migration:create -- <context> <feature> <PascalCaseDescription>',
  );
  process.exit(2);
}

const timestamp = await uniqueTimestamp();

const migrationDirectory = resolve(
  repositoryRoot,
  'src/modules',
  context,
  feature,
  'migrations',
);
const featureDirectory = resolve(repositoryRoot, 'src/modules', context, feature);
const migrationPath = join(
  migrationDirectory,
  `${timestamp}-${description}.ts`,
);
const className = `${description}${timestamp}`;
const template = `import type { PoolClient } from 'pg';
import type { MigrationInterface } from '../../../../database/migrations/migration.interface';

export class ${className} implements MigrationInterface {
  async up(queryRunner: PoolClient): Promise<void> {
    void queryRunner;
    throw new Error('Implement ${className}.up before applying this migration.');
  }

  async down(queryRunner: PoolClient): Promise<void> {
    void queryRunner;
    throw new Error('Implement ${className}.down before rolling back this migration.');
  }
}
`;

const featureEntries = await readdir(featureDirectory, { withFileTypes: true }).catch(
  () => [],
);
if (!featureEntries.some((entry) => entry.isFile() && entry.name.endsWith('.module.ts'))) {
  console.error(
    `No active feature module exists at ${relative(repositoryRoot, featureDirectory)}.`,
  );
  process.exit(2);
}

await mkdir(migrationDirectory, { recursive: true });
try {
  await writeFile(migrationPath, template, { flag: 'wx' });
} catch (error) {
  if (error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST') {
    console.error(`Migration already exists: ${relative(repositoryRoot, migrationPath)}`);
    process.exit(1);
  }
  throw error;
}
console.log(`Created ${relative(repositoryRoot, migrationPath)}`);

async function uniqueTimestamp() {
  while (true) {
    const timestampResult = spawnSync('date', ['+%s%3N'], { encoding: 'utf8' });
    if (timestampResult.error) throw timestampResult.error;
    if (timestampResult.status !== 0) {
      throw new Error('Could not read the system Unix-millisecond timestamp.');
    }
    const timestamp = timestampResult.stdout.trim();
    if (!/^\d{13}$/.test(timestamp)) {
      throw new Error(
        'date +%s%3N did not return a 13-digit Unix-millisecond value.',
      );
    }
    if (!(await timestampExists(timestamp))) return timestamp;
  }
}

async function timestampExists(timestamp) {
  const root = resolve(repositoryRoot, 'src/modules');
  return inspect(root, timestamp);
}

async function inspect(directory, timestamp) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (await inspect(path, timestamp)) return true;
    } else if (entry.isFile() && entry.name.startsWith(`${timestamp}-`)) {
      return true;
    }
  }
  return false;
}
