import { Inject, Injectable } from '@nestjs/common';
import type { AuthenticatedPrincipal } from '../../../identity/authentication/types/authenticated-principal';
import { PLATFORM_PERMISSION } from '../../../identity/platform-authorization/constants/platform-permissions';
import type { PlatformPermission } from '../../../identity/platform-authorization/constants/platform-permissions';
import { PlatformAuthorizationService } from '../../../identity/platform-authorization/services/platform-authorization.service';
import { ContentCatalogRepository } from '../repositories/content-catalog.repository';
import type {
  ContentLifecycleRecord,
  ContentRevisionListResult,
  ContentRevisionRecord,
  ContentRevisionSummary,
  PublishedContentRecord,
  ContentImportState,
  ContentCatalogImportState,
  ContentCatalogSnapshotV1,
  PublicContentCatalogRecord,
  StoredPublicContentCatalog,
  ContentStatus,
  ContentArticleRoutePreflightReport,
  ContentCatalogRedirectV1,
} from '../types/content-catalog.types';
import {
  CONTENT_STATUS,
  ContentItemNotFoundError,
  ContentLifecycleTransitionError,
  ContentPermissionDeniedError,
  ContentRevisionNotFoundError,
  ContentSearchValidationError,
  ContentCatalogNotReadyError,
  ContentCatalogSnapshotConflictError,
  ContentRouteNotPublishableError,
  ContentRouteConflictError,
  ContentRouteRemediationRequiredError,
} from '../types/content-catalog.types';
import {
  validateContentDocument,
  validateContentKey,
} from '../types/content-document';
import {
  assertCanonicalArticleSlug,
  isCanonicalArticleSlug,
  normalizeArticleSlug,
} from '../types/content-slug';
import { checksumContent } from '../helpers/content-checksum';
import { buildArticleRoutePreflightReport } from '../helpers/content-route-preflight';
import {
  ContentCatalogSnapshotValidationError,
  validateContentCatalogSnapshot,
} from '../types/content-catalog-snapshot';
import {
  decodeContentListCursor,
  decodeRevisionCursor,
  encodeContentListCursor,
  encodeRevisionCursor,
} from '../helpers/content-pagination';

type ContentCatalogStore = Pick<
  ContentCatalogRepository,
  | 'createArticle'
  | 'createPublishedArticle'
  | 'changeArticleRoute'
  | 'findImportStateByKey'
  | 'findImportStateBySlug'
  | 'appendRevision'
  | 'findRevision'
  | 'publishRevision'
  | 'findPublishedByKey'
  | 'findPublishedBySlug'
  | 'searchPublishedContent'
  | 'findGitContentCatalogImportState'
  | 'storeGitContentCatalogSnapshot'
  | 'findPublicContentCatalog'
  | 'findLifecycle'
  | 'transitionStatus'
  | 'listContent'
  | 'listRevisions'
  | 'listArticleRoutePreflightRows'
>;

type PlatformAuthorization = Pick<
  PlatformAuthorizationService,
  'hasPermissions'
>;

const ALLOWED_TRANSITIONS: Readonly<
  Record<ContentStatus, readonly ContentStatus[]>
> = {
  DRAFT: [CONTENT_STATUS.IN_REVIEW, CONTENT_STATUS.ARCHIVED],
  IN_REVIEW: [
    CONTENT_STATUS.DRAFT,
    CONTENT_STATUS.PUBLISHED,
    CONTENT_STATUS.ARCHIVED,
  ],
  PUBLISHED: [CONTENT_STATUS.DRAFT, CONTENT_STATUS.ARCHIVED],
  ARCHIVED: [CONTENT_STATUS.DRAFT],
};

const MAX_PUBLIC_SEARCH_QUERY_LENGTH = 160;
const MAX_PUBLIC_SEARCH_RESULTS = 20;
// Legacy non-canonical published rows can rank ahead of valid routes until A01.2 remediation.
const MAX_PUBLIC_SEARCH_CANDIDATES = 100;

@Injectable()
export class ContentCatalogService {
  constructor(
    @Inject(ContentCatalogRepository)
    private readonly repository: ContentCatalogStore,
    @Inject(PlatformAuthorizationService)
    private readonly authorization: PlatformAuthorization,
  ) {}

  async createArticle(
    contentKey: string,
    slug: unknown,
    document: unknown,
    principal: AuthenticatedPrincipal,
  ): Promise<ContentRevisionRecord> {
    await this.requirePermission(principal, PLATFORM_PERMISSION.CONTENT_CREATE);
    const validatedKey = validateContentKey(contentKey);
    const validatedSlug = normalizeArticleSlug(slug);
    const validatedDocument = validateContentDocument(document);
    return this.repository.createArticle({
      contentKey: validatedKey,
      slug: validatedSlug,
      actorAccountId: principal.accountId,
      document: validatedDocument,
      checksumSha256: checksumContent(validatedDocument),
    });
  }

  async findGitImportState(
    contentKey: string,
    principal: AuthenticatedPrincipal,
  ): Promise<ContentImportState | null> {
    await this.requirePermission(principal, PLATFORM_PERMISSION.CONTENT_READ);
    return this.repository.findImportStateByKey(validateContentKey(contentKey));
  }

  async findGitImportStateBySlug(
    slug: unknown,
    principal: AuthenticatedPrincipal,
  ): Promise<ContentImportState | null> {
    await this.requirePermission(principal, PLATFORM_PERMISSION.CONTENT_READ);
    return this.repository.findImportStateBySlug(
      assertCanonicalArticleSlug(slug),
    );
  }

  async findGitContentCatalogImportState(
    sourceCommitSha: string,
    principal: AuthenticatedPrincipal,
  ): Promise<ContentCatalogImportState | null> {
    await this.requirePermission(principal, PLATFORM_PERMISSION.CONTENT_READ);
    if (!/^[a-f0-9]{40}$/.test(sourceCommitSha)) {
      throw new TypeError('The source commit SHA is invalid.');
    }
    return this.repository.findGitContentCatalogImportState(sourceCommitSha);
  }

  async storeGitContentCatalogSnapshot(
    sourceCommitSha: string,
    value: unknown,
    principal: AuthenticatedPrincipal,
  ): Promise<string> {
    await this.requirePermissions(principal, [
      PLATFORM_PERMISSION.CONTENT_CREATE,
      PLATFORM_PERMISSION.CONTENT_UPDATE,
      PLATFORM_PERMISSION.CONTENT_PUBLISH,
    ]);
    if (!/^[a-f0-9]{40}$/.test(sourceCommitSha)) {
      throw new TypeError('The source commit SHA is invalid.');
    }
    const catalog = validateContentCatalogSnapshot(value);
    const checksumSha256 = checksumContent(catalog);
    await this.repository.storeGitContentCatalogSnapshot({
      sourceCommitSha,
      checksumSha256,
      catalog,
      actorAccountId: principal.accountId,
    });
    return checksumSha256;
  }

  authorizeGitContentImport(
    write: boolean,
    principal: AuthenticatedPrincipal,
  ): Promise<void> {
    return this.requirePermissions(
      principal,
      write
        ? [
            PLATFORM_PERMISSION.CONTENT_READ,
            PLATFORM_PERMISSION.CONTENT_CREATE,
            PLATFORM_PERMISSION.CONTENT_UPDATE,
            PLATFORM_PERMISSION.CONTENT_PUBLISH,
          ]
        : [PLATFORM_PERMISSION.CONTENT_READ],
    );
  }

  async createPublishedGitImportArticle(
    input: { contentKey: string; slug: unknown; document: unknown },
    principal: AuthenticatedPrincipal,
  ): Promise<PublishedContentRecord> {
    await this.requirePermissions(principal, [
      PLATFORM_PERMISSION.CONTENT_CREATE,
      PLATFORM_PERMISSION.CONTENT_UPDATE,
      PLATFORM_PERMISSION.CONTENT_PUBLISH,
    ]);
    const contentKey = validateContentKey(input.contentKey);
    const slug = assertCanonicalArticleSlug(input.slug);
    const document = validateContentDocument(input.document);
    assertAllowedTransition(CONTENT_STATUS.DRAFT, CONTENT_STATUS.IN_REVIEW);
    assertAllowedTransition(CONTENT_STATUS.IN_REVIEW, CONTENT_STATUS.PUBLISHED);
    return this.repository.createPublishedArticle({
      contentKey,
      slug,
      actorAccountId: principal.accountId,
      document,
      checksumSha256: checksumContent(document),
    });
  }

  async appendRevision(
    contentId: string,
    baseRevisionId: string,
    document: unknown,
    principal: AuthenticatedPrincipal,
  ): Promise<ContentRevisionRecord> {
    await this.requirePermission(principal, PLATFORM_PERMISSION.CONTENT_UPDATE);
    if (!baseRevisionId.trim()) {
      throw new TypeError('baseRevisionId is required.');
    }
    const validatedDocument = validateContentDocument(document);
    return this.repository.appendRevision({
      contentId,
      baseRevisionId,
      actorAccountId: principal.accountId,
      document: validatedDocument,
      checksumSha256: checksumContent(validatedDocument),
    });
  }

  async publishRevision(
    contentId: string,
    revisionId: string,
    principal: AuthenticatedPrincipal,
  ): Promise<PublishedContentRecord> {
    await this.requirePermission(
      principal,
      PLATFORM_PERMISSION.CONTENT_PUBLISH,
    );
    const item = await this.repository.findLifecycle(contentId);
    if (!item) throw new ContentItemNotFoundError();
    if (item.contentType !== 'article' || !isCanonicalArticleSlug(item.slug)) {
      throw new ContentRouteNotPublishableError();
    }
    assertAllowedTransition(item.status, CONTENT_STATUS.PUBLISHED);
    const revision = await this.repository.findRevision(contentId, revisionId);
    if (!revision) throw new ContentRevisionNotFoundError();
    validateContentDocument(revision.document);
    return this.repository.publishRevision({
      contentId,
      revisionId,
      expectedStatus: item.status,
      actorAccountId: principal.accountId,
    });
  }

  submitForReview(
    contentId: string,
    principal: AuthenticatedPrincipal,
  ): Promise<ContentLifecycleRecord> {
    return this.transitionTo(
      contentId,
      CONTENT_STATUS.IN_REVIEW,
      PLATFORM_PERMISSION.CONTENT_UPDATE,
      principal,
    );
  }

  returnToDraft(
    contentId: string,
    principal: AuthenticatedPrincipal,
  ): Promise<ContentLifecycleRecord> {
    return this.transitionTo(
      contentId,
      CONTENT_STATUS.DRAFT,
      PLATFORM_PERMISSION.CONTENT_UPDATE,
      principal,
    );
  }

  startDraft(
    contentId: string,
    principal: AuthenticatedPrincipal,
  ): Promise<ContentLifecycleRecord> {
    return this.transitionTo(
      contentId,
      CONTENT_STATUS.DRAFT,
      PLATFORM_PERMISSION.CONTENT_UPDATE,
      principal,
    );
  }

  archiveContent(
    contentId: string,
    principal: AuthenticatedPrincipal,
  ): Promise<ContentLifecycleRecord> {
    return this.transitionTo(
      contentId,
      CONTENT_STATUS.ARCHIVED,
      PLATFORM_PERMISSION.CONTENT_ARCHIVE,
      principal,
    );
  }

  restoreArchivedContent(
    contentId: string,
    principal: AuthenticatedPrincipal,
  ): Promise<ContentLifecycleRecord> {
    return this.transitionTo(
      contentId,
      CONTENT_STATUS.DRAFT,
      PLATFORM_PERMISSION.CONTENT_ARCHIVE,
      principal,
    );
  }

  async changeArticleRoute(
    contentId: string,
    baseSlug: string,
    slug: unknown,
    principal: AuthenticatedPrincipal,
  ): Promise<ContentLifecycleRecord> {
    await this.requirePermission(
      principal,
      PLATFORM_PERMISSION.CONTENT_PUBLISH,
    );
    const requestedSlug = normalizeArticleSlug(slug);
    const current = await this.repository.findLifecycle(contentId);
    if (!current) throw new ContentItemNotFoundError();
    if (current.slug !== baseSlug) throw new ContentRouteConflictError();
    if (current.status === CONTENT_STATUS.ARCHIVED) {
      throw new ContentLifecycleTransitionError();
    }
    if (!isCanonicalArticleSlug(current.slug)) {
      throw new ContentRouteRemediationRequiredError();
    }
    return this.repository.changeArticleRoute({
      contentId,
      baseSlug,
      slug: requestedSlug,
      actorAccountId: principal.accountId,
    });
  }

  findPublishedByKey(
    contentKey: string,
  ): Promise<PublishedContentRecord | null> {
    return this.repository.findPublishedByKey(validateContentKey(contentKey));
  }

  async searchPublishedContent(
    query: unknown,
  ): Promise<PublishedContentRecord[]> {
    if (query === undefined) return [];
    if (
      typeof query !== 'string' ||
      query.length > MAX_PUBLIC_SEARCH_QUERY_LENGTH
    ) {
      throw new ContentSearchValidationError();
    }
    const normalizedQuery = query.trim();
    if (!normalizedQuery) return [];
    const candidates = await this.repository.searchPublishedContent(
      normalizedQuery,
      MAX_PUBLIC_SEARCH_CANDIDATES,
    );
    return candidates
      .filter((candidate) => isCanonicalArticleSlug(candidate.slug))
      .slice(0, MAX_PUBLIC_SEARCH_RESULTS);
  }

  async getPublicContentCatalog(): Promise<PublicContentCatalogRecord> {
    const stored: StoredPublicContentCatalog | null =
      await this.repository.findPublicContentCatalog();
    if (!stored) throw new ContentCatalogNotReadyError();
    let catalog: ContentCatalogSnapshotV1;
    try {
      catalog = validateContentCatalogSnapshot(stored.catalog);
    } catch (error) {
      if (error instanceof ContentCatalogSnapshotValidationError) {
        throw new ContentCatalogSnapshotConflictError();
      }
      throw error;
    }
    if (checksumContent(catalog) !== stored.checksumSha256) {
      throw new ContentCatalogSnapshotConflictError();
    }
    const metadataByKey = new Map(
      catalog.articles.map((article) => [article.contentKey, article]),
    );
    const canonicalPublishedArticles = stored.publishedArticles.filter(
      (article) => isCanonicalArticleSlug(article.slug),
    );
    const publishedByKey = new Map(
      canonicalPublishedArticles.map((article) => [
        article.contentKey,
        article,
      ]),
    );
    const articles = canonicalPublishedArticles.flatMap((published) => {
      const metadata = metadataByKey.get(published.contentKey);
      if (!metadata) return [];
      return [
        {
          ...metadata,
          contentId: published.contentId,
          slug: published.slug,
          title: published.title,
          description: published.description,
          publishedRevisionId: published.publishedRevisionId,
          publishedAt: published.publishedAt.toISOString(),
          url: `/${published.slug}/`,
          prerequisites: metadata.prerequisites.filter((id) =>
            publishedByKey.has(`article:${id}`),
          ),
          related: metadata.related.filter((id) =>
            publishedByKey.has(`article:${id}`),
          ),
        },
      ];
    });
    const publishedSourceIds = new Set(
      articles.map((article) => article.sourceId),
    );
    const paths = catalog.paths.map((learningPath) => ({
      ...learningPath,
      modules: learningPath.modules.map((module) => ({
        ...module,
        articleIds: module.articleIds.filter((id) =>
          publishedSourceIds.has(id),
        ),
      })),
    }));
    const redirects = mergePublicRedirects([
      ...stored.routeRedirects
        .filter(
          (redirect) =>
            isCanonicalArticleSlug(redirect.sourceSlug) &&
            isCanonicalArticleSlug(redirect.currentSlug),
        )
        .map((redirect) => ({
          source: `/${redirect.sourceSlug}/`,
          destination: `/${redirect.currentSlug}/`,
          kind: 'article' as const,
        })),
      ...articles.flatMap((article) =>
        article.legacyUrls.map((source) => ({
          source,
          destination: article.url,
          kind: 'article' as const,
        })),
      ),
      ...paths.flatMap((learningPath) => [
        ...learningPath.legacyIndexUrls.map((source) => ({
          source,
          destination: `/paths/${learningPath.id}/`,
          kind: 'path-module' as const,
        })),
        ...learningPath.modules.flatMap((module) =>
          module.legacyIndexUrls.map((source) => ({
            source,
            destination: `/paths/${learningPath.id}/#module-${module.id}`,
            kind: 'path-module' as const,
          })),
        ),
      ]),
    ]);
    return {
      schema_version: 1,
      sourceCommitSha: stored.sourceCommitSha,
      checksumSha256: stored.checksumSha256,
      createdAt: stored.createdAt,
      site: catalog.site,
      topics: catalog.topics,
      categories: catalog.categories,
      paths,
      articles,
      redirects,
    };
  }

  async listContent(
    input: { limit: number; cursor?: string; status?: ContentStatus },
    principal: AuthenticatedPrincipal,
  ): Promise<{ items: ContentLifecycleRecord[]; nextCursor: string | null }> {
    await this.requirePermission(principal, PLATFORM_PERMISSION.CONTENT_READ);
    const before = decodeContentListCursor(input.cursor);
    const page = await this.repository.listContent({
      limit: input.limit,
      ...(input.status ? { status: input.status } : {}),
      ...(before ? { before } : {}),
    });
    return {
      items: page.items,
      nextCursor: page.nextCursor
        ? encodeContentListCursor(page.nextCursor)
        : null,
    };
  }

  async getContent(
    contentId: string,
    principal: AuthenticatedPrincipal,
  ): Promise<ContentLifecycleRecord> {
    await this.requirePermission(principal, PLATFORM_PERMISSION.CONTENT_READ);
    const item = await this.repository.findLifecycle(contentId);
    if (!item) throw new ContentItemNotFoundError();
    return item;
  }

  async listRevisions(
    contentId: string,
    input: { limit: number; cursor?: string },
    principal: AuthenticatedPrincipal,
  ): Promise<{ items: ContentRevisionSummary[]; nextCursor: string | null }> {
    await this.requirePermission(principal, PLATFORM_PERMISSION.CONTENT_READ);
    if (!(await this.repository.findLifecycle(contentId))) {
      throw new ContentItemNotFoundError();
    }
    const beforeRevisionNumber = decodeRevisionCursor(input.cursor);
    const page: ContentRevisionListResult = await this.repository.listRevisions(
      contentId,
      input.limit,
      beforeRevisionNumber,
    );
    return {
      items: page.items,
      nextCursor: page.nextCursor
        ? encodeRevisionCursor(page.nextCursor)
        : null,
    };
  }

  async getRevision(
    contentId: string,
    revisionId: string,
    principal: AuthenticatedPrincipal,
  ): Promise<ContentRevisionRecord> {
    await this.requirePermission(principal, PLATFORM_PERMISSION.CONTENT_READ);
    const revision = await this.repository.findRevision(contentId, revisionId);
    if (!revision) throw new ContentRevisionNotFoundError();
    return revision;
  }

  findPublishedBySlug(slug: string): Promise<PublishedContentRecord | null> {
    return this.repository.findPublishedBySlug(
      assertCanonicalArticleSlug(slug),
    );
  }

  async preflightArticleRoutes(): Promise<ContentArticleRoutePreflightReport> {
    const rows = await this.repository.listArticleRoutePreflightRows();
    return buildArticleRoutePreflightReport(rows);
  }

  private async transitionTo(
    contentId: string,
    nextStatus: ContentStatus,
    permission: PlatformPermission,
    principal: AuthenticatedPrincipal,
  ): Promise<ContentLifecycleRecord> {
    await this.requirePermission(principal, permission);
    const item = await this.repository.findLifecycle(contentId);
    if (!item) throw new ContentItemNotFoundError();
    assertAllowedTransition(item.status, nextStatus);
    return this.repository.transitionStatus({
      contentId,
      expectedStatus: item.status,
      nextStatus,
      actorAccountId: principal.accountId,
    });
  }

  private async requirePermission(
    principal: AuthenticatedPrincipal,
    permission: PlatformPermission,
  ): Promise<void> {
    await this.requirePermissions(principal, [permission]);
  }

  private async requirePermissions(
    principal: AuthenticatedPrincipal,
    permissions: readonly PlatformPermission[],
  ): Promise<void> {
    if (!(await this.authorization.hasPermissions(principal, permissions))) {
      throw new ContentPermissionDeniedError();
    }
  }
}

function assertAllowedTransition(
  currentStatus: ContentStatus,
  nextStatus: ContentStatus,
): void {
  if (!ALLOWED_TRANSITIONS[currentStatus].includes(nextStatus)) {
    throw new ContentLifecycleTransitionError();
  }
}

function mergePublicRedirects(
  redirects: readonly ContentCatalogRedirectV1[],
): ContentCatalogRedirectV1[] {
  const bySource = new Map<string, ContentCatalogRedirectV1>();
  for (const redirect of redirects) {
    const existing = bySource.get(redirect.source);
    if (!existing) {
      bySource.set(redirect.source, redirect);
      continue;
    }
    if (
      existing.destination !== redirect.destination ||
      existing.kind !== redirect.kind
    ) {
      throw new ContentCatalogSnapshotConflictError();
    }
  }
  return [...bySource.values()];
}
