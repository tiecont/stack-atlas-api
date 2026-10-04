import type { ContentArticleRoutePreflightReport } from '../../../src/modules/content/catalog/types/content-catalog.types.js';

export interface ContentRoutePreflightArtifact
  extends ContentArticleRoutePreflightReport {
  generatedAt: string;
}

export type ContentRoutePreflightExecutionResult =
  | {
      exitCode: 0 | 1;
      report: ContentRoutePreflightArtifact;
      reportPath: string;
    }
  | {
      exitCode: 2;
      errorMessage: string;
    };

export function parseContentRoutePreflightArguments(
  arguments_: readonly string[],
): { reportDirectory: string };

export function formatContentRoutePreflightSummary(
  report: ContentArticleRoutePreflightReport,
): string;

export function contentRoutePreflightExitCode(
  report: ContentArticleRoutePreflightReport,
): 0 | 1;

export function writeContentRoutePreflightReport(
  report: ContentRoutePreflightArtifact,
  directory: string,
  now?: Date,
): string;

export function executeContentRoutePreflight(
  arguments_: readonly string[],
  audit: () => Promise<ContentArticleRoutePreflightReport>,
  now?: Date,
): Promise<ContentRoutePreflightExecutionResult>;
