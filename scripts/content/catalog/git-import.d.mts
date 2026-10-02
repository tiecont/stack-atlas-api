import type { GitContentImportReport } from '../../../src/modules/content/catalog/types/git-content-import.types.js';

export interface GitContentImportCommand {
  mode: 'dry-run' | 'apply' | 'verify';
  source: string;
  accountId: string;
  sessionId: string;
  confirmation?: string;
  reportDir?: string;
}

export interface GitContentImportReportPaths {
  jsonPath: string;
  markdownPath: string;
}

export function parseGitContentImportCommand(
  arguments_: string[],
): GitContentImportCommand;

export function assertSourceCommitConfirmation(
  mode: GitContentImportCommand['mode'],
  confirmation: string | undefined,
  commitSha: string,
): void;

export function writeGitContentImportReport(
  report: GitContentImportReport,
  directory: string,
  now?: Date,
): Promise<GitContentImportReportPaths>;

export function formatMarkdownReport(
  report: GitContentImportReport,
  generatedAt: string,
): string;
