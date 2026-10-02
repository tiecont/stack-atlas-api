import { Inject, Injectable } from '@nestjs/common';
import { checksumContent } from '../helpers/content-checksum';
import { ContentCatalogService } from './content-catalog.service';
import type { ContentDocumentV1 } from '../types/content-document';
import type { AuthenticatedPrincipal } from '../../../identity/authentication/types/authenticated-principal';
import type {
  GitContentImportArticleResult,
  GitContentImportMode,
  GitContentImportReport,
  GitContentRelationshipMismatch,
  GitContentSnapshot,
  GitContentSourceArticle,
} from '../types/git-content-import.types';

type ContentImportCatalog = Pick<
  ContentCatalogService,
  | 'authorizeGitContentImport'
  | 'findGitImportState'
  | 'createPublishedGitImportArticle'
>;

interface PlannedArticle {
  article: GitContentSourceArticle;
  result: GitContentImportArticleResult;
}

@Injectable()
export class GitContentImportService {
  constructor(
    @Inject(ContentCatalogService)
    private readonly catalog: ContentImportCatalog,
  ) {}

  async run(
    snapshot: GitContentSnapshot,
    mode: GitContentImportMode,
    principal: AuthenticatedPrincipal,
  ): Promise<GitContentImportReport> {
    const planned: PlannedArticle[] = [];
    const sourceErrors = [...snapshot.sourceErrors];
    let authorizationFailure: string | undefined;
    try {
      await this.catalog.authorizeGitContentImport(mode === 'apply', principal);
    } catch (error) {
      authorizationFailure = safeErrorMessage(error);
    }
    const unsupportedConstructs = snapshot.articles.flatMap((article) => [
      ...article.warnings,
      ...article.errors.filter((error) =>
        /^(unsupported|unsafe_|event_handler|table_|image_|nested_list|too_many_content_blocks)/.test(
          error.code,
        ),
      ),
    ]);
    const relationshipMismatches = relationshipGaps(snapshot);

    for (const article of snapshot.articles) {
      if (authorizationFailure) {
        planned.push({
          article,
          result: resultFor(article, 'failed', authorizationFailure),
        });
        continue;
      }
      if (article.errors.length > 0 || !isImportableSource(article)) {
        const errors = article.errors;
        sourceErrors.push(...errors);
        planned.push({
          article,
          result: resultFor(
            article,
            'failed',
            errors.map((error) => error.message).join('; ') ||
              'Article metadata did not produce an importable document.',
          ),
        });
        continue;
      }
      if (article.sourceStatus !== 'published') {
        planned.push({
          article,
          result: resultFor(
            article,
            'skipped',
            `Source status ${article.sourceStatus ?? 'unknown'} is not published.`,
          ),
        });
        continue;
      }
      try {
        const existing = await this.catalog.findGitImportState(
          article.contentKey,
          principal,
        );
        if (!existing) {
          planned.push({ article, result: resultFor(article, 'ready') });
        } else if (matchesSource(existing, article)) {
          planned.push({
            article,
            result: resultFor(
              article,
              mode === 'verify' ? 'verified' : 'already_imported',
            ),
          });
        } else {
          planned.push({
            article,
            result: resultFor(
              article,
              'failed',
              'Existing content identity differs from the Git snapshot; no overwrite was attempted.',
            ),
          });
        }
      } catch (error) {
        planned.push({
          article,
          result: resultFor(article, 'failed', safeErrorMessage(error)),
        });
      }
    }

    for (const sourceError of snapshot.sourceErrors) {
      planned.push({
        article: emptyArticle(sourceError),
        result: {
          sourceId: null,
          contentKey: null,
          sourceFiles: [sourceError.sourcePath],
          status: 'failed',
          message: sourceError.message,
        },
      });
    }

    if (mode === 'apply') {
      const hasPreflightFailure = planned.some(
        ({ result }) => result.status === 'failed',
      );
      if (hasPreflightFailure) {
        for (const entry of planned) {
          if (entry.result.status === 'ready') {
            entry.result = resultFor(
              entry.article,
              'skipped',
              'No writes were made because snapshot preflight found a failure.',
            );
          }
        }
      } else {
        await this.applyReadyArticles(planned, principal);
      }
    }

    if (mode === 'verify') {
      for (const entry of planned) {
        if (entry.result.status === 'ready') {
          entry.result = resultFor(
            entry.article,
            'failed',
            'Content identity is not present in PostgreSQL.',
          );
        }
      }
    }

    const articleResults = planned.map(({ result }) => result);
    const summary = {
      discovered: snapshot.articles.length + snapshot.sourceErrors.length,
      importable: articleResults.filter((article) =>
        ['ready', 'already_imported', 'imported', 'verified'].includes(
          article.status,
        ),
      ).length,
      imported: articleResults.filter(
        (article) => article.status === 'imported',
      ).length,
      skipped: articleResults.filter((article) => article.status === 'skipped')
        .length,
      failed: articleResults.filter((article) => article.status === 'failed')
        .length,
      unsupportedConstructs: unsupportedConstructs.length,
      relationshipMismatches: relationshipMismatches.length,
    };
    return {
      source: {
        repository: snapshot.repository,
        commitSha: snapshot.commitSha,
        inventory: snapshot.inventory,
      },
      mode,
      summary,
      articles: articleResults,
      unsupportedConstructs,
      relationshipMismatches,
      sourceErrors,
    };
  }

  private async applyReadyArticles(
    planned: PlannedArticle[],
    principal: AuthenticatedPrincipal,
  ): Promise<void> {
    for (let index = 0; index < planned.length; index += 1) {
      const entry = planned[index];
      if (!entry || entry.result.status !== 'ready') continue;
      const { article } = entry;
      if (!article.document || !article.contentKey || !article.slug) {
        entry.result = resultFor(
          article,
          'failed',
          'Validated source data is missing.',
        );
        break;
      }
      try {
        await this.catalog.createPublishedGitImportArticle(
          {
            contentKey: article.contentKey,
            slug: article.slug,
            document: article.document,
          },
          principal,
        );
        const verified = await this.catalog.findGitImportState(
          article.contentKey,
          principal,
        );
        if (!verified || !matchesSource(verified, article)) {
          entry.result = resultFor(
            article,
            'failed',
            'The committed import did not match the source snapshot on verification.',
          );
          break;
        }
        entry.result = resultFor(article, 'imported');
      } catch (error) {
        entry.result = resultFor(article, 'failed', safeErrorMessage(error));
        break;
      }
    }
    const firstFailure = planned.findIndex(
      ({ result }) => result.status === 'failed',
    );
    if (firstFailure >= 0) {
      for (let index = firstFailure + 1; index < planned.length; index += 1) {
        const entry = planned[index];
        if (entry?.result.status === 'ready') {
          entry.result = resultFor(
            entry.article,
            'skipped',
            'Not attempted after an earlier import failure; rerun to resume.',
          );
        }
      }
    }
  }
}

function isImportableSource(
  article: GitContentSourceArticle,
): article is GitContentSourceArticle & {
  sourceId: string;
  contentKey: string;
  slug: string;
  title: string;
  description: string;
  document: ContentDocumentV1;
} {
  return Boolean(
    article.contentKey &&
    article.slug &&
    article.document &&
    article.sourceId &&
    article.title &&
    article.description,
  );
}

function matchesSource(
  existing: {
    slug: string;
    status: string;
    latestRevisionId: string | null;
    publishedRevisionId: string | null;
    latestRevisionChecksumSha256: string | null;
  },
  article: GitContentSourceArticle,
): boolean {
  return Boolean(
    article.document &&
    existing.slug === article.slug &&
    existing.status === 'PUBLISHED' &&
    existing.latestRevisionId &&
    existing.latestRevisionId === existing.publishedRevisionId &&
    existing.latestRevisionChecksumSha256 === checksumContent(article.document),
  );
}

function relationshipGaps(
  snapshot: GitContentSnapshot,
): GitContentRelationshipMismatch[] {
  const mismatches: GitContentRelationshipMismatch[] = [];
  const articleIds = new Set(
    snapshot.articles
      .map((article) => article.sourceId)
      .filter((articleId): articleId is string => articleId !== null),
  );
  for (const article of snapshot.articles) {
    if (
      article.contentKey &&
      (article.relationships.domain ||
        article.relationships.category ||
        article.relationships.tags.length > 0)
    ) {
      mismatches.push({
        contentKey: article.contentKey,
        relationship: 'topic_metadata',
        sourceValue: {
          domain: article.relationships.domain,
          category: article.relationships.category,
          tags: article.relationships.tags,
        },
        reason:
          'The current API content model has no taxonomy or topic persistence.',
      });
    }
    if (
      article.contentKey &&
      (article.relationships.authors.length > 0 ||
        article.relationships.difficulty ||
        article.relationships.kubernetes ||
        article.relationships.review)
    ) {
      mismatches.push({
        contentKey: article.contentKey,
        relationship: 'article_metadata',
        sourceValue: {
          authors: article.relationships.authors,
          difficulty: article.relationships.difficulty,
          kubernetes: article.relationships.kubernetes,
          review: article.relationships.review,
        },
        reason:
          'The current API content model has no author, difficulty, platform detail, or review metadata fields.',
      });
    }
    if (article.contentKey && article.relationships.labs.length > 0) {
      mismatches.push({
        contentKey: article.contentKey,
        relationship: 'lab_reference',
        sourceValue: article.relationships.labs,
        reason:
          'The current API content model has no lab relationship persistence.',
      });
    }
    for (const membership of article.relationships.learningPaths) {
      if (!article.contentKey) continue;
      const path = snapshot.pathRecords.find(
        (record) => record.id === membership.pathId,
      );
      const moduleExists = path?.modules.some(
        (module) => module.id === membership.moduleId,
      );
      mismatches.push({
        contentKey: article.contentKey,
        relationship: 'path_membership',
        sourceValue: {
          ...membership,
          unresolvedPath: !path,
          unresolvedModule: Boolean(path) && !moduleExists,
        },
        reason:
          'The current API content model has no learning path or module ordering persistence.',
      });
    }
    if (article.relationships.prerequisites.length > 0 && article.contentKey) {
      mismatches.push({
        contentKey: article.contentKey,
        relationship: 'prerequisite',
        sourceValue: {
          articleIds: article.relationships.prerequisites,
          unresolvedArticleIds: article.relationships.prerequisites.filter(
            (prerequisite) => !articleIds.has(prerequisite),
          ),
        },
        reason:
          'The current API content model has no prerequisite relationship persistence.',
      });
    }
    if (article.relationships.legacyUrls.length > 0 && article.contentKey) {
      mismatches.push({
        contentKey: article.contentKey,
        relationship: 'legacy_redirect',
        sourceValue: article.relationships.legacyUrls,
        reason:
          'The current API content model has no legacy redirect persistence.',
      });
    }
  }
  for (const path of snapshot.pathRecords) {
    mismatches.push({
      contentKey: `path:${path.id}`,
      relationship: 'path_metadata',
      sourceValue: path.sourceMetadata,
      reason:
        'The current API content model has no learning path metadata persistence.',
    });
    for (const module of path.modules) {
      mismatches.push({
        contentKey: `path:${path.id}`,
        relationship: 'path_membership',
        sourceValue: {
          ...module.sourceMetadata,
          unresolvedArticleIds: module.articleIds.filter(
            (articleId) => !articleIds.has(articleId),
          ),
        },
        reason:
          'The current API content model has no learning path/module identity or ordering persistence.',
      });
      const moduleLegacyUrls = module.sourceMetadata['legacy_index_urls'];
      if (
        Array.isArray(moduleLegacyUrls) &&
        moduleLegacyUrls.length > 0 &&
        moduleLegacyUrls.every((url) => typeof url === 'string')
      ) {
        mismatches.push({
          contentKey: `path:${path.id}`,
          relationship: 'legacy_redirect',
          sourceValue: {
            moduleId: module.id,
            urls: moduleLegacyUrls,
          },
          reason:
            'The current API content model has no module redirect persistence.',
        });
      }
    }
    if (path.legacyIndexUrls.length > 0) {
      mismatches.push({
        contentKey: `path:${path.id}`,
        relationship: 'legacy_redirect',
        sourceValue: path.legacyIndexUrls,
        reason:
          'The current API content model has no path redirect persistence.',
      });
    }
  }
  return mismatches;
}

function resultFor(
  article: GitContentSourceArticle,
  status: GitContentImportArticleResult['status'],
  message?: string,
): GitContentImportArticleResult {
  return {
    sourceId: article.sourceId,
    contentKey: article.contentKey,
    sourceFiles: article.sourceFiles,
    status,
    ...(message ? { message } : {}),
  };
}

function emptyArticle(issue: { sourcePath: string }): GitContentSourceArticle {
  return {
    sourceId: null,
    contentKey: null,
    slug: null,
    title: null,
    description: null,
    sourceStatus: null,
    document: null,
    sourceFiles: [issue.sourcePath],
    sourceChecksumSha256: null,
    relationships: {
      domain: null,
      category: null,
      tags: [],
      authors: [],
      difficulty: null,
      labs: [],
      kubernetes: null,
      review: null,
      learningPaths: [],
      prerequisites: [],
      related: [],
      legacyUrls: [],
    },
    warnings: [],
    errors: [],
  };
}

function safeErrorMessage(error: unknown): string {
  if (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    error.name === 'ContentPermissionDeniedError'
  ) {
    return 'The active session does not have the required content permissions.';
  }
  return error instanceof Error
    ? error.message
    : 'Unknown content import error.';
}
