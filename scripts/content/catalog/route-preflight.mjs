import { NestFactory } from '@nestjs/core';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULT_REPORT_DIRECTORY = 'content-route-preflight-reports';

export function parseContentRoutePreflightArguments(arguments_) {
  const parsed = new Map();
  for (let index = 0; index < arguments_.length; index += 1) {
    const option = arguments_[index];
    const value = arguments_[index + 1];
    if (
      option !== '--report-dir' ||
      !value ||
      value.startsWith('--') ||
      parsed.has(option)
    ) {
      throw new Error(usage());
    }
    parsed.set(option, value);
    index += 1;
  }
  return {
    reportDirectory: path.resolve(
      parsed.get('--report-dir') ?? DEFAULT_REPORT_DIRECTORY,
    ),
  };
}

export function formatContentRoutePreflightSummary(report) {
  const { summary } = report;
  return [
    `articles=${summary.totalArticles}`,
    `canonical=${summary.canonical}`,
    `invalid=${summary.invalid}`,
    `published_invalid=${summary.publishedInvalid}`,
    `draft_review_invalid=${summary.draftReviewInvalid}`,
    `archived_invalid=${summary.archivedInvalid}`,
    `suggestion_collisions=${summary.suggestionCollisions}`,
    `blockers=${summary.blockers}`,
    `warnings=${summary.warnings}`,
  ].join(', ');
}

export function contentRoutePreflightExitCode(report) {
  return report.summary.blockers > 0 ? 1 : 0;
}

export function writeContentRoutePreflightReport(
  report,
  directory,
  now = new Date(),
) {
  const generatedAt = now.toISOString();
  const suffix = generatedAt.replace(/[:.]/g, '-');
  const reportPath = path.join(
    directory,
    `content-route-preflight-${suffix}.json`,
  );
  mkdirSync(directory, { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return reportPath;
}

export async function executeContentRoutePreflight(
  arguments_,
  audit,
  now = new Date(),
) {
  let command;
  try {
    command = parseContentRoutePreflightArguments(arguments_);
  } catch {
    return {
      exitCode: 2,
      errorMessage: usage(),
    };
  }

  let auditReport;
  try {
    auditReport = await audit();
  } catch {
    return {
      exitCode: 2,
      errorMessage:
        'Content route preflight failed due to configuration or runtime error. No database changes were made.',
    };
  }

  const report = {
    generatedAt: now.toISOString(),
    ...auditReport,
  };
  try {
    const reportPath = writeContentRoutePreflightReport(
      report,
      command.reportDirectory,
      now,
    );
    return {
      exitCode: contentRoutePreflightExitCode(report),
      report,
      reportPath,
    };
  } catch {
    return {
      exitCode: 2,
      errorMessage:
        'Content route preflight could not write its report. No database changes were made.',
    };
  }
}

async function auditArticleRoutes() {
  const [{ AppModule }, { ContentCatalogService }] = await Promise.all([
    import('../../../dist/app.module.js'),
    import(
      '../../../dist/modules/content/catalog/services/content-catalog.service.js'
    ),
  ]);
  const application = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });
  try {
    return await application
      .get(ContentCatalogService)
      .preflightArticleRoutes();
  } finally {
    await application.close();
  }
}

function usage() {
  return [
    'Usage:',
    '  npm run content:route-preflight [-- --report-dir <directory>]',
  ].join('\n');
}

async function run(arguments_) {
  const result = await executeContentRoutePreflight(
    arguments_,
    auditArticleRoutes,
  );
  if (result.exitCode === 2) {
    console.error(result.errorMessage);
  } else {
    console.log(formatContentRoutePreflightSummary(result.report));
    console.log(`JSON report: ${result.reportPath}`);
  }
  process.exitCode = result.exitCode;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run(process.argv.slice(2)).catch(() => {
    console.error(
      'Content route preflight failed due to configuration or runtime error. No database changes were made.',
    );
    process.exitCode = 2;
  });
}
