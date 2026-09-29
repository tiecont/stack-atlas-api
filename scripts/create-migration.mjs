import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, renameSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [context, feature, name, ...extra] = process.argv.slice(2);
const segmentPattern = /^[a-z][a-z0-9-]*$/;
const namePattern = /^[a-z][a-z0-9_-]*$/;

if (
  !context ||
  !feature ||
  !name ||
  extra.length > 0 ||
  !segmentPattern.test(context) ||
  !segmentPattern.test(feature) ||
  !namePattern.test(name)
) {
  console.error(
    'Usage: npm run migration:create -- <context> <feature> <migration_name>',
  );
  process.exit(2);
}

const migrationDirectory = resolve(
  repositoryRoot,
  'database/migrations',
  context,
  feature,
);
mkdirSync(migrationDirectory, { recursive: true });
const before = new Set(readdirSync(migrationDirectory));
const cliPath = resolve(
  repositoryRoot,
  'node_modules/node-pg-migrate/bin/node-pg-migrate.js',
);
const result = spawnSync(
  process.execPath,
  [
    cliPath,
    'create',
    '--migrations-dir',
    relative(repositoryRoot, migrationDirectory),
    '--migration-file-language',
    'js',
    '--migration-filename-format',
    'utc',
    name,
  ],
  { cwd: repositoryRoot, encoding: 'utf8' },
);

if (result.error) throw result.error;
if (result.stderr) process.stderr.write(result.stderr);
if (result.status !== 0) {
  if (result.stdout) process.stdout.write(result.stdout);
  process.exit(result.status ?? 1);
}

const createdFiles = readdirSync(migrationDirectory).filter(
  (file) => !before.has(file),
);
if (createdFiles.length !== 1) {
  throw new Error('Expected the migration generator to create exactly one file.');
}

const generatedFile = createdFiles[0];
if (!generatedFile) throw new Error('Generated migration filename is missing.');
const match = /^(\d{17})_(.+)\.js$/.exec(generatedFile);
if (!match) {
  throw new Error(`Unexpected generated migration filename: ${generatedFile}`);
}

// Preserve the generated UTC timestamp while sorting after the legacy 14-digit
// UTC migrations. The millisecond suffix also keeps same-second names ordered.
const generatedTimestamp = match[1];
const generatedName = match[2];
if (!generatedTimestamp || !generatedName) {
  throw new Error(`Could not parse generated migration filename: ${generatedFile}`);
}
const compatibleTimestamp = `${generatedTimestamp.slice(0, 14)}-${generatedTimestamp.slice(14)}`;
const extension = '.js';
let target = `${compatibleTimestamp}_${generatedName}${extension}`;
let suffix = 1;
while (existsSync(resolve(migrationDirectory, target))) {
  target = `${compatibleTimestamp}-${suffix}_${generatedName}${extension}`;
  suffix += 1;
}

renameSync(
  resolve(migrationDirectory, generatedFile),
  resolve(migrationDirectory, target),
);
console.log(`Created ${relative(repositoryRoot, resolve(migrationDirectory, target))}`);
