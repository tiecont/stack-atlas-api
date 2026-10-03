import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assertSourceCommitConfirmation,
  parseGitContentImportCommand,
  writeGitContentImportReport,
} from '../../../scripts/content/catalog/git-import.mjs';
import type { GitContentImportReport } from '../../../src/modules/content/catalog/types/git-content-import.types.js';

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('Git content import command', () => {
  it('requires the exact source SHA before apply can write', () => {
    const sha = 'a'.repeat(40);
    const command = parseGitContentImportCommand([
      'apply',
      ...requiredOptions(),
      '--confirm',
      sha.toUpperCase(),
    ]);

    expect(command.confirmation).toBe(sha);
    expect(() => assertSourceCommitConfirmation('apply', command.confirmation, sha)).not.toThrow();
    expect(() => assertSourceCommitConfirmation('apply', 'b'.repeat(40), sha)).toThrow(
      'No database writes were made',
    );
    expect(() =>
      parseGitContentImportCommand(['apply', ...requiredOptions()]),
    ).toThrow('Apply requires --confirm');
  });

  it('does not accept an apply confirmation on read-only modes', () => {
    expect(() =>
      parseGitContentImportCommand([
        'dry-run',
        ...requiredOptions(),
        '--confirm',
        'a'.repeat(40),
      ]),
    ).toThrow('Usage:');
  });

  it('writes machine-readable and human-readable reports with snapshot identity', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'stack-atlas-import-report-'));
    temporaryRoots.push(directory);
    const report: GitContentImportReport = {
      mode: 'dry-run',
      source: {
        repository: 'tiecont/stack-atlas',
        commitSha: 'c'.repeat(40),
        inventory: [{ path: 'content/articles/a/article.yaml', sha256: 'd'.repeat(64) }],
      },
      summary: {
        discovered: 1,
        importable: 1,
        imported: 0,
        skipped: 0,
        failed: 0,
        unsupportedConstructs: 0,
        relationshipMismatches: 0,
      },
      catalogSnapshot: {
        status: 'ready',
        checksumSha256: 'e'.repeat(64),
      },
      articles: [],
      unsupportedConstructs: [],
      relationshipMismatches: [],
      sourceErrors: [],
    };

    const paths = await writeGitContentImportReport(
      report,
      directory,
      new Date('2026-10-02T00:00:00.000Z'),
    );

    expect(readdirSync(directory)).toHaveLength(2);
    expect(JSON.parse(readFileSync(paths.jsonPath, 'utf8'))).toMatchObject({
      source: { repository: 'tiecont/stack-atlas', commitSha: 'c'.repeat(40) },
    });
    expect(readFileSync(paths.markdownPath, 'utf8')).toContain(
      'tiecont/stack-atlas@' + 'c'.repeat(40),
    );
    expect(readFileSync(paths.markdownPath, 'utf8')).toContain(
      'content/articles/a/article.yaml',
    );
  });
});

function requiredOptions(): string[] {
  return [
    '--source',
    '../web',
    '--account-id',
    '20000000-0000-4000-8000-000000000001',
    '--session-id',
    '30000000-0000-4000-8000-000000000001',
  ];
}
