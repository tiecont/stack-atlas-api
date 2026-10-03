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
import { isCanonicalArticleSlug } from '../types/content-slug';

type ContentImportCatalog = Pick<
  ContentCatalogService,
  | 'authorizeGitContentImport'
  | 'findGitImportState'
  | 'findGitImportStateBySlug'
  | 'createPublishedGitImportArticle'
  | 'findGitContentCatalogImportState'
  | 'storeGitContentCatalogSnapshot'
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
    const catalogChecksumSha256 = checksumContent(snapshot.catalog);
    const catalogSnapshot: GitContentImportReport['catalogSnapshot'] = {
      status: 'ready',
      checksumSha256: catalogChecksumSha256,
    };
    let authorizationFailure: string | undefined;
    let catalogStateFailure: string | undefined;
    let catalogState: Awaited<
      ReturnType<ContentCatalogService['findGitContentCatalogImportState']>
    > = null;
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
    const duplicateSlugs = duplicatePublishedSlugs(snapshot.articles);

    if (!authorizationFailure) {
      try {
        catalogState = await this.catalog.findGitContentCatalogImportState(
          snapshot.commitSha,
          principal,
        );
        if (
          catalogState &&
          catalogState.checksumSha256 !== catalogChecksumSha256
        ) {
          catalogStateFailure =
            'The catalog snapshot checksum for this source commit differs from the validated source.';
        } else if (catalogState?.isActive && mode !== 'verify') {
          catalogSnapshot.status = 'already_imported';
        }
      } catch (error) {
        catalogStateFailure = safeErrorMessage(error);
      }
    } else {
      catalogStateFailure = authorizationFailure;
    }
    if (catalogStateFailure) {
      catalogSnapshot.status = 'failed';
      catalogSnapshot.message = catalogStateFailure;
    }

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
      if (!isCanonicalArticleSlug(article.slug)) {
        planned.push({
          article,
          result: resultFor(
            article,
            'failed',
            'The article route must match articles/<domain>/<slug>.',
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
      if (article.slug && duplicateSlugs.has(article.slug)) {
        planned.push({
          article,
          result: resultFor(
            article,
            'failed',
            'Multiple published source articles resolve to the same slug.',
          ),
        });
        continue;
      }
      try {
        const existingSlug = await this.catalog.findGitImportStateBySlug(
          article.slug,
          principal,
        );
        if (existingSlug && existingSlug.contentKey !== article.contentKey) {
          planned.push({
            article,
            result: resultFor(
              article,
              'failed',
              'The source slug is already owned by a different active content identity.',
            ),
          });
          continue;
        }
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
      const hasPreflightFailure =
        planned.some(({ result }) => result.status === 'failed') ||
        relationshipMismatches.length > 0 ||
        Boolean(catalogStateFailure);
      if (hasPreflightFailure) {
        catalogSnapshot.status = 'failed';
        catalogSnapshot.message =
          relationshipMismatches.length > 0
            ? 'Snapshot preflight found unresolved catalog references.'
            : 'Snapshot preflight failed; no catalog snapshot was activated.';
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
        if (!planned.some(({ result }) => result.status === 'failed')) {
          if (!catalogState?.isActive) {
            try {
              await this.catalog.storeGitContentCatalogSnapshot(
                snapshot.commitSha,
                snapshot.catalog,
                principal,
              );
              catalogSnapshot.status = 'imported';
            } catch (error) {
              catalogSnapshot.status = 'failed';
              catalogSnapshot.message = safeErrorMessage(error);
            }
          }
        }
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
      if (
        !catalogState ||
        !catalogState.isActive ||
        catalogState.checksumSha256 !== catalogChecksumSha256
      ) {
        catalogSnapshot.status = 'failed';
        catalogSnapshot.message =
          'The active PostgreSQL catalog snapshot does not match this source commit.';
      } else if (!planned.some(({ result }) => result.status === 'failed')) {
        catalogSnapshot.status = 'verified';
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
      failed:
        articleResults.filter((article) => article.status === 'failed').length +
        (catalogSnapshot.status === 'failed' ? 1 : 0),
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
      catalogSnapshot,
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

function duplicatePublishedSlugs(
  articles: GitContentSourceArticle[],
): Set<string> {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const article of articles) {
    if (article.sourceStatus !== 'published' || !article.slug) continue;
    if (seen.has(article.slug)) duplicates.add(article.slug);
    else seen.add(article.slug);
  }
  return duplicates;
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
  const topicIds = new Set(snapshot.catalog.topics.map((topic) => topic.id));
  const categoryIds = new Set(
    snapshot.catalog.categories.map((category) => category.id),
  );
  const pathById = new Map(
    snapshot.catalog.paths.map((path) => [path.id, path]),
  );
  for (const article of snapshot.articles) {
    const domain = article.relationships.domain;
    if (article.contentKey && domain && !topicIds.has(domain)) {
      mismatches.push({
        contentKey: article.contentKey,
        relationship: 'topic_metadata',
        sourceValue: domain,
        reason: 'Article topic metadata points to a missing topic record.',
      });
    }
    const category = article.relationships.category;
    if (article.contentKey && category && !categoryIds.has(category)) {
      mismatches.push({
        contentKey: article.contentKey,
        relationship: 'topic_metadata',
        sourceValue: category,
        reason:
          'Article category metadata points to a missing category record.',
      });
    }
    for (const membership of article.relationships.learningPaths) {
      if (!article.contentKey) continue;
      const learningPath = pathById.get(membership.pathId);
      const moduleExists = learningPath?.modules.some(
        (module) => module.id === membership.moduleId,
      );
      if (!moduleExists) {
        mismatches.push({
          contentKey: article.contentKey,
          relationship: 'path_membership',
          sourceValue: membership,
          reason: 'Article membership points to a missing path or module.',
        });
      }
    }
    const unresolvedArticleIds = [
      ...article.relationships.prerequisites,
      ...article.relationships.related,
    ].filter((reference) => !articleIds.has(reference));
    if (unresolvedArticleIds.length > 0 && article.contentKey) {
      mismatches.push({
        contentKey: article.contentKey,
        relationship: 'prerequisite',
        sourceValue: unresolvedArticleIds,
        reason:
          'Article prerequisite or related-content metadata points to a missing article.',
      });
    }
  }
  for (const learningPath of snapshot.catalog.paths) {
    for (const module of learningPath.modules) {
      const unknownTopic = !topicIds.has(module.domain);
      const unknownCategory = !categoryIds.has(module.category);
      const unresolvedArticleIds = module.articleIds.filter(
        (articleId) => !articleIds.has(articleId),
      );
      if (unknownTopic || unknownCategory || unresolvedArticleIds.length > 0) {
        mismatches.push({
          contentKey: `path:${learningPath.id}`,
          relationship: 'path_membership',
          sourceValue: {
            moduleId: module.id,
            unknownTopic: unknownTopic ? module.domain : null,
            unknownCategory: unknownCategory ? module.category : null,
            unresolvedArticleIds,
          },
          reason:
            'Path module metadata references a missing topic, category, or article.',
        });
      }
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
