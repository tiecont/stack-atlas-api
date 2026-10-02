import { NestFactory } from '@nestjs/core';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ACCOUNT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA_PATTERN = /^[0-9a-f]{40}$/i;

export function parseGitContentImportCommand(arguments_) {
  const [mode, ...options] = arguments_;
  if (!['dry-run', 'apply', 'verify'].includes(mode)) {
    throw new Error(usage());
  }

  const parsed = new Map();
  for (let index = 0; index < options.length; index += 1) {
    const option = options[index];
    const name = option?.startsWith('--') ? option.slice(2) : '';
    const value = options[index + 1];
    if (
      !['source', 'account-id', 'session-id', 'confirm', 'report-dir'].includes(name) ||
      !value ||
      value.startsWith('--') ||
      parsed.has(name)
    ) {
      throw new Error(usage());
    }
    parsed.set(name, value);
    index += 1;
  }

  const source = parsed.get('source');
  const accountId = parsed.get('account-id');
  const sessionId = parsed.get('session-id');
  const confirmation = parsed.get('confirm');
  const reportDir = parsed.get('report-dir');
  if (
    !source ||
    !accountId ||
    !ACCOUNT_ID_PATTERN.test(accountId) ||
    !sessionId ||
    !ACCOUNT_ID_PATTERN.test(sessionId) ||
    (mode === 'apply' && !SHA_PATTERN.test(confirmation ?? '')) ||
    (mode !== 'apply' && confirmation !== undefined)
  ) {
    throw new Error(
      mode === 'apply' && !confirmation
        ? `Apply requires --confirm <exact-source-commit-sha>.\n${usage()}`
        : usage(),
    );
  }
  return {
    mode,
    source: path.resolve(source),
    accountId,
    sessionId,
    ...(confirmation ? { confirmation: confirmation.toLowerCase() } : {}),
    ...(reportDir ? { reportDir: path.resolve(reportDir) } : {}),
  };
}

export function assertSourceCommitConfirmation(mode, confirmation, commitSha) {
  if (mode !== 'apply') return;
  if (!confirmation || confirmation !== commitSha) {
    throw new Error(
      `Confirmation SHA does not match the source snapshot ${commitSha}. No database writes were made.`,
    );
  }
}

export async function writeGitContentImportReport(report, directory, now = new Date()) {
  const generatedAt = now.toISOString();
  const suffix = generatedAt.replace(/[:.]/g, '-');
  const baseName = `content-import-${report.mode}-${report.source.commitSha}-${suffix}`;
  mkdirSync(directory, { recursive: true });
  const jsonPath = path.join(directory, `${baseName}.json`);
  const markdownPath = path.join(directory, `${baseName}.md`);
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  writeFileSync(markdownPath, formatMarkdownReport(report, generatedAt), 'utf8');
  return { jsonPath, markdownPath };
}

export function formatMarkdownReport(report, generatedAt) {
  const lines = [
    '# Git Content Import Report',
    '',
    `Generated: ${generatedAt}`,
    `Mode: ${report.mode}`,
    `Source: ${report.source.repository}@${report.source.commitSha}`,
    '',
    '## Summary',
    '',
    '| Discovered | Importable | Imported | Skipped | Failed | Unsupported | Relationship gaps |',
    '| ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    `| ${report.summary.discovered} | ${report.summary.importable} | ${report.summary.imported} | ${report.summary.skipped} | ${report.summary.failed} | ${report.summary.unsupportedConstructs} | ${report.summary.relationshipMismatches} |`,
    '',
    `Inventory files: ${report.source.inventory.length}`,
    '',
    '## Failures',
    '',
  ];
  const failures = report.articles.filter((article) => article.status === 'failed');
  if (failures.length === 0) lines.push('None.');
  else {
    for (const failure of failures) {
      lines.push(`- ${failure.contentKey ?? failure.sourceFiles.join(', ')}: ${failure.message ?? 'Import failed.'}`);
    }
  }
  lines.push('', '## Unsupported Constructs', '');
  if (report.unsupportedConstructs.length === 0) lines.push('None.');
  else {
    for (const unsupported of report.unsupportedConstructs) {
      lines.push(`- ${unsupported.sourcePath}: ${unsupported.code}: ${unsupported.message}`);
    }
  }
  lines.push('', '## Relationship Gaps', '');
  if (report.relationshipMismatches.length === 0) lines.push('None.');
  else {
    for (const mismatch of report.relationshipMismatches) {
      lines.push(`- ${mismatch.contentKey}: ${mismatch.relationship}: ${mismatch.reason}`);
    }
  }
  lines.push('', '## Source Inventory', '');
  for (const file of report.source.inventory) {
    lines.push(`- ${file.path}  sha256:${file.sha256}`);
  }
  lines.push('');
  return lines.join('\n');
}

async function run(arguments_) {
  const command = parseGitContentImportCommand(arguments_);
  const { parseGitContentSnapshot } = await import(
    '../../../dist/modules/content/catalog/helpers/git-content-source.js'
  );
  const snapshot = await parseGitContentSnapshot(command.source);
  assertSourceCommitConfirmation(
    command.mode,
    command.confirmation,
    snapshot.commitSha,
  );

  const [{ AppModule }, { AccountService }, { GitContentImportService }] =
    await Promise.all([
      import('../../../dist/app.module.js'),
      import('../../../dist/modules/identity/account/services/account.service.js'),
      import('../../../dist/modules/content/catalog/services/git-content-import.service.js'),
    ]);
  const application = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });
  let report;
  try {
    const account = await application
      .get(AccountService)
      .findById(command.accountId);
    if (!account) throw new Error('The import actor account does not exist.');
    const principal = {
      accountId: account.id,
      sessionId: command.sessionId,
      email: account.email,
    };
    report = await application
      .get(GitContentImportService)
      .run(snapshot, command.mode, principal);
  } finally {
    await application.close();
  }

  const reportDir =
    command.reportDir ??
    path.resolve('content-import-reports', snapshot.commitSha);
  const reportPaths = await writeGitContentImportReport(report, reportDir);
  console.log(
    `${report.mode}: discovered=${report.summary.discovered}, importable=${report.summary.importable}, imported=${report.summary.imported}, skipped=${report.summary.skipped}, failed=${report.summary.failed}, unsupported=${report.summary.unsupportedConstructs}, relationship_gaps=${report.summary.relationshipMismatches}`,
  );
  console.log(`JSON report: ${reportPaths.jsonPath}`);
  console.log(`Markdown report: ${reportPaths.markdownPath}`);
  if (report.summary.failed > 0) process.exitCode = 1;
}

function usage() {
  return [
    'Usage:',
    '  npm run content:git-import -- dry-run --source <clean-web-checkout> --account-id <uuid> --session-id <uuid> [--report-dir <path>]',
    '  npm run content:git-import -- apply --source <clean-web-checkout> --account-id <uuid> --session-id <uuid> --confirm <source-sha> [--report-dir <path>]',
    '  npm run content:git-import -- verify --source <clean-web-checkout> --account-id <uuid> --session-id <uuid> [--report-dir <path>]',
  ].join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : 'Git content import failed.');
    process.exitCode = 1;
  });
}
