import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  contentRoutePreflightExitCode,
  executeContentRoutePreflight,
  formatContentRoutePreflightSummary,
  parseContentRoutePreflightArguments,
} from '../../../scripts/content/catalog/route-preflight.mjs';
import { buildArticleRoutePreflightReport } from '../../../src/modules/content/catalog/helpers/content-route-preflight.js';

const temporaryDirectories: string[] = [];
const generatedAt = new Date('2026-10-03T00:00:00.000Z');

function temporaryDirectory(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'content-route-preflight-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('content route preflight CLI', () => {
  it('parses the optional report directory and rejects unknown arguments', () => {
    expect(parseContentRoutePreflightArguments([]).reportDirectory).toBe(
      path.resolve('content-route-preflight-reports'),
    );
    expect(
      parseContentRoutePreflightArguments([
        '--report-dir',
        '/tmp/content-route-report',
      ]).reportDirectory,
    ).toBe(path.resolve('/tmp/content-route-report'));
    expect(() =>
      parseContentRoutePreflightArguments(['--apply']),
    ).toThrow('Usage:');
  });

  it('formats a clean report, writes stable JSON, and exits successfully', async () => {
    const report = buildArticleRoutePreflightReport([
      {
        contentId: 'clean-id',
        contentKey: 'article:clean',
        contentType: 'article',
        slug: 'articles/architecture/clean-guide',
        status: 'DRAFT',
        archivedAt: null,
        publishedRevisionId: null,
      },
    ]);
    const reportDirectory = temporaryDirectory();
    expect(contentRoutePreflightExitCode(report)).toBe(0);
    expect(formatContentRoutePreflightSummary(report)).toContain(
      'articles=1, canonical=1, invalid=0',
    );

    const result = await executeContentRoutePreflight(
      ['--report-dir', reportDirectory],
      async () => report,
      generatedAt,
    );

    expect(result.exitCode).toBe(0);
    if (result.exitCode === 2) throw new Error(result.errorMessage);
    const written = JSON.parse(readFileSync(result.reportPath, 'utf8')) as {
      generatedAt: string;
      rows: { contentKey: string }[];
      summary: { blockers: number };
    };
    expect(written).toMatchObject({
      generatedAt: generatedAt.toISOString(),
      summary: { blockers: 0 },
      rows: [{ contentKey: 'article:clean' }],
    });
    expect(JSON.stringify(written)).not.toMatch(/DATABASE_URL|secret|password/i);
  });

  it('returns a blocking exit code and a report when invalid rows exist', async () => {
    const report = buildArticleRoutePreflightReport([
      {
        contentId: 'invalid-id',
        contentKey: 'article:invalid',
        contentType: 'article',
        slug: 'engineering/new-guide',
        status: 'PUBLISHED',
        archivedAt: null,
        publishedRevisionId: 'revision-1',
      },
    ]);
    const result = await executeContentRoutePreflight(
      ['--report-dir', temporaryDirectory()],
      async () => report,
      generatedAt,
    );

    expect(result.exitCode).toBe(1);
    if (result.exitCode === 2) throw new Error(result.errorMessage);
    expect(result.report.summary).toMatchObject({
      invalid: 1,
      publishedInvalid: 1,
      blockers: 1,
    });
  });

  it('uses exit code 2 for configuration or runtime failures without exposing details', async () => {
    const result = await executeContentRoutePreflight(
      ['--report-dir', temporaryDirectory()],
      async () => {
        throw new Error('DATABASE_URL=postgres://secret/password');
      },
      generatedAt,
    );

    expect(result).toMatchObject({
      exitCode: 2,
      errorMessage:
        'Content route preflight failed due to configuration or runtime error. No database changes were made.',
    });
    expect(JSON.stringify(result)).not.toMatch(/secret|DATABASE_URL|password/i);
  });
});
