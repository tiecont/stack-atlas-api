import { readdir, readFile } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const modulesRoot = resolve(repositoryRoot, 'src/modules');
const filenamePattern = /^(\d{13})-([A-Z][A-Za-z0-9]*)\.ts$/;
const seenTimestamps = new Set();
const violations = [];

await walk(modulesRoot);

if (violations.length > 0) {
  for (const violation of violations) console.error(violation);
  process.exitCode = 1;
} else {
  console.log('Feature migration timestamps and class names are valid.');
}

async function walk(directory, migrationKind) {
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
      await walk(path, childKind);
      continue;
    }
    if (!entry.isFile() || !migrationKind || !entry.name.endsWith('.ts')) continue;

    const match = filenamePattern.exec(entry.name);
    if (!match) {
      violations.push(`Invalid ${migrationKind} migration filename: ${path}`);
      continue;
    }
    const timestamp = match[1];
    const description = match[2];
    if (!timestamp || !description) {
      violations.push(`Invalid ${migrationKind} migration filename: ${path}`);
      continue;
    }
    if (seenTimestamps.has(timestamp)) {
      violations.push(`Duplicate migration timestamp ${timestamp}: ${path}`);
    }
    seenTimestamps.add(timestamp);

    const source = await readFile(path, 'utf8');
    const className = `${description}${timestamp}`;
    if (
      !source.includes(`export class ${className}`) ||
      !source.includes('implements MigrationInterface')
    ) {
      violations.push(
        `Migration ${path} must export class ${className} implementing MigrationInterface.`,
      );
    }
  }
}
