import { describe, expect, it, vi } from 'vitest';
import { PLATFORM_PERMISSION } from '../../../identity/platform-authorization/constants/platform-permissions';
import type { PlatformAuthorizationService } from '../../../identity/platform-authorization/services/platform-authorization.service';
import { ContentCatalogService } from './content-catalog.service';
import type { ContentCatalogRepository } from '../repositories/content-catalog.repository';
import type { PublishedContentRecord } from '../types/content-catalog.types';
import {
  CONTENT_STATUS,
  ContentLifecycleTransitionError,
  ContentPermissionDeniedError,
  ContentSearchValidationError,
  ContentCatalogSnapshotConflictError,
  ContentRouteNotPublishableError,
} from '../types/content-catalog.types';
import {
  ContentDocumentValidationError,
  validateContentDocument,
} from '../types/content-document';
import { ContentArticleRouteValidationError } from '../types/content-slug';
import type { AuthenticatedPrincipal } from '../../../identity/authentication/types/authenticated-principal';
import { checksumContent } from '../helpers/content-checksum';
import { ContentCatalogNotReadyError } from '../types/content-catalog.types';

const principal: AuthenticatedPrincipal = {
  accountId: '20000000-0000-4000-8000-000000000001',
  sessionId: '30000000-0000-4000-8000-000000000001',
  email: 'ignored@example.test',
};

const document = {
  schema_version: 1,
  title: 'Reliable systems',
  description: 'A short guide.',
  blocks: [
    {
      id: 'body',
      type: 'rich_text',
      version: 1,
      props: {
        nodes: [
          {
            type: 'paragraph',
            children: [
              {
                type: 'text',
                text: 'Transactions make state changes durable.',
              },
            ],
          },
        ],
      },
    },
  ],
};

function createRepository() {
  return {
    createArticle: vi.fn(),
    createPublishedArticle: vi.fn(),
    findImportStateByKey: vi.fn(),
    findImportStateBySlug: vi.fn(),
    appendRevision: vi.fn(),
    findRevision: vi.fn(),
    publishRevision: vi.fn(),
    findPublishedByKey: vi.fn(),
    findPublishedBySlug: vi.fn(),
    searchPublishedContent: vi.fn(),
    findGitContentCatalogImportState: vi.fn(),
    storeGitContentCatalogSnapshot: vi.fn(),
    findPublicContentCatalog: vi.fn(),
    findLifecycle: vi.fn(),
    listArticleRoutePreflightRows: vi.fn(),
    transitionStatus: vi.fn(),
    listContent: vi.fn(),
    listRevisions: vi.fn(),
  } satisfies Pick<
    ContentCatalogRepository,
    | 'createArticle'
    | 'createPublishedArticle'
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
    | 'listArticleRoutePreflightRows'
    | 'transitionStatus'
    | 'listContent'
    | 'listRevisions'
  >;
}

function createAuthorization() {
  return {
    hasPermissions: vi.fn().mockResolvedValue(true),
  } satisfies Pick<PlatformAuthorizationService, 'hasPermissions'>;
}

function lifecycle(status: keyof typeof CONTENT_STATUS) {
  return {
    contentId: 'content-1',
    contentKey: 'article:reliable-systems',
    contentType: 'article' as const,
    slug: 'articles/architecture/reliable-systems',
    status: CONTENT_STATUS[status],
    latestRevisionId: 'revision-1',
    publishedRevisionId: null,
    createdBy: principal.accountId,
    archivedAt: null,
    archivedBy: null,
    createdAt: new Date('2026-09-30T00:00:00.000Z'),
    updatedAt: new Date('2026-09-30T00:00:00.000Z'),
  };
}

function publishedContent(slug: string, index: number): PublishedContentRecord {
  return {
    contentId: `content-${index}`,
    contentKey: `article:content-${index}`,
    contentType: 'article',
    slug,
    status: CONTENT_STATUS.PUBLISHED,
    createdBy: principal.accountId,
    revisionCreatedBy: principal.accountId,
    revisionId: `revision-${index}`,
    revisionNumber: 1,
    schemaVersion: 1,
    checksumSha256: 'a'.repeat(64),
    document: validateContentDocument(document),
    createdAt: new Date('2026-10-02T00:00:00.000Z'),
    publishedAt: new Date('2026-10-02T00:00:00.000Z'),
    publishedBy: principal.accountId,
  };
}

describe('ContentCatalogService', () => {
  it('normalizes a canonical article route and attributes item and revision to the principal', async () => {
    const repository = createRepository();
    const authorization = createAuthorization();
    const service = new ContentCatalogService(repository, authorization);

    await service.createArticle(
      'article:reliable-systems',
      ' ARTICLES / Architecture / Reliable   Systems ',
      document,
      principal,
    );

    expect(authorization.hasPermissions).toHaveBeenCalledWith(principal, [
      PLATFORM_PERMISSION.CONTENT_CREATE,
    ]);
    expect(repository.createArticle).toHaveBeenCalledWith({
      contentKey: 'article:reliable-systems',
      slug: 'articles/architecture/reliable-systems',
      actorAccountId: principal.accountId,
      document,
      checksumSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
  });

  it('rejects non-canonical article routes and invalid documents before persistence', async () => {
    const repository = createRepository();
    const service = new ContentCatalogService(
      repository,
      createAuthorization(),
    );

    await expect(
      service.createArticle(
        'article:reliable-systems',
        'engineering/new-guide',
        document,
        principal,
      ),
    ).rejects.toBeInstanceOf(ContentArticleRouteValidationError);
    await expect(
      service.createArticle(
        'article:reliable-systems',
        'articles/architecture/reliable-systems',
        { ...document, blocks: [{ type: 'paragraph' }] },
        principal,
      ),
    ).rejects.toBeInstanceOf(ContentDocumentValidationError);
    expect(repository.createArticle).not.toHaveBeenCalled();
  });

  it('requires the canonical route on published Git imports', async () => {
    const repository = createRepository();
    repository.createPublishedArticle.mockResolvedValue({} as never);
    const service = new ContentCatalogService(
      repository,
      createAuthorization(),
    );

    await expect(
      service.createPublishedGitImportArticle(
        {
          contentKey: 'article:git-route',
          slug: 'engineering/new-guide',
          document,
        },
        principal,
      ),
    ).rejects.toBeInstanceOf(ContentArticleRouteValidationError);
    expect(repository.createPublishedArticle).not.toHaveBeenCalled();

    await service.createPublishedGitImportArticle(
      {
        contentKey: 'article:git-route',
        slug: 'articles/architecture/new-guide',
        document,
      },
      principal,
    );
    expect(repository.createPublishedArticle).toHaveBeenCalledWith(
      expect.objectContaining({
        contentKey: 'article:git-route',
        slug: 'articles/architecture/new-guide',
      }),
    );
  });

  it('blocks publication of a historical non-canonical route before persistence', async () => {
    const repository = createRepository();
    repository.findLifecycle.mockResolvedValue({
      ...lifecycle('IN_REVIEW'),
      slug: 'legacy-domain/legacy-article',
    });
    const service = new ContentCatalogService(
      repository,
      createAuthorization(),
    );

    await expect(
      service.publishRevision('content-1', 'revision-1', principal),
    ).rejects.toBeInstanceOf(ContentRouteNotPublishableError);
    expect(repository.findRevision).not.toHaveBeenCalled();
    expect(repository.publishRevision).not.toHaveBeenCalled();
  });

  it('preserves canonical publication behavior and validates public lookup routes', async () => {
    const repository = createRepository();
    repository.findLifecycle.mockResolvedValue(lifecycle('IN_REVIEW'));
    repository.findRevision.mockResolvedValue({ document } as never);
    repository.publishRevision.mockResolvedValue({} as never);
    repository.findPublishedBySlug.mockResolvedValue(null);
    const service = new ContentCatalogService(
      repository,
      createAuthorization(),
    );

    await service.publishRevision('content-1', 'revision-1', principal);
    expect(repository.publishRevision).toHaveBeenCalledWith({
      contentId: 'content-1',
      revisionId: 'revision-1',
      expectedStatus: CONTENT_STATUS.IN_REVIEW,
      actorAccountId: principal.accountId,
    });

    expect(() => service.findPublishedBySlug('engineering/new-guide')).toThrow(
      ContentArticleRouteValidationError,
    );
    expect(repository.findPublishedBySlug).not.toHaveBeenCalled();
    await expect(
      service.findPublishedBySlug('articles/architecture/reliable-systems'),
    ).resolves.toBeNull();
    expect(repository.findPublishedBySlug).toHaveBeenCalledWith(
      'articles/architecture/reliable-systems',
    );
  });

  it('builds its operator preflight from repository-owned article rows', async () => {
    const repository = createRepository();
    repository.listArticleRoutePreflightRows.mockResolvedValue([
      {
        contentId: 'canonical-id',
        contentKey: 'article:canonical',
        contentType: 'article',
        slug: 'articles/architecture/guide',
        status: 'DRAFT',
        archivedAt: null,
        publishedRevisionId: null,
      },
      {
        contentId: 'legacy-id',
        contentKey: 'article:legacy',
        contentType: 'article',
        slug: 'architecture/old-guide',
        status: 'PUBLISHED',
        archivedAt: null,
        publishedRevisionId: 'revision-legacy',
      },
    ]);
    const service = new ContentCatalogService(
      repository,
      createAuthorization(),
    );

    await expect(service.preflightArticleRoutes()).resolves.toMatchObject({
      summary: {
        totalArticles: 2,
        canonical: 1,
        invalid: 1,
        publishedInvalid: 1,
        blockers: 1,
      },
      rows: [
        expect.objectContaining({
          contentId: 'canonical-id',
          classification: 'canonical',
          severity: 'INFO',
        }),
        expect.objectContaining({
          contentId: 'legacy-id',
          reason: 'missing_articles_prefix',
          suggestion: {
            slug: 'articles/architecture/old-guide',
            authoritative: false,
          },
        }),
      ],
    });
    expect(repository.listArticleRoutePreflightRows).toHaveBeenCalledOnce();
  });

  it('requires a base revision and records the authenticated revision creator', async () => {
    const repository = createRepository();
    const service = new ContentCatalogService(
      repository,
      createAuthorization(),
    );
    repository.appendRevision.mockResolvedValue({} as never);

    await service.appendRevision(
      'content-1',
      'revision-12',
      document,
      principal,
    );

    expect(repository.appendRevision).toHaveBeenCalledWith({
      contentId: 'content-1',
      baseRevisionId: 'revision-12',
      actorAccountId: principal.accountId,
      document,
      checksumSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
  });

  it('looks up normalized Git import slugs under content:read permission', async () => {
    const repository = createRepository();
    repository.findImportStateBySlug.mockResolvedValue(null);
    const authorization = createAuthorization();
    const service = new ContentCatalogService(repository, authorization);

    await service.findGitImportStateBySlug(
      'articles/architecture/stable',
      principal,
    );

    expect(authorization.hasPermissions).toHaveBeenCalledWith(principal, [
      PLATFORM_PERMISSION.CONTENT_READ,
    ]);
    expect(repository.findImportStateBySlug).toHaveBeenCalledWith(
      'articles/architecture/stable',
    );
  });

  it('searches published content with a bounded query and result count', async () => {
    const repository = createRepository();
    repository.searchPublishedContent.mockResolvedValue([]);
    const service = new ContentCatalogService(
      repository,
      createAuthorization(),
    );

    expect(await service.searchPublishedContent('  transaction  ')).toEqual([]);
    expect(repository.searchPublishedContent).toHaveBeenCalledWith(
      'transaction',
      100,
    );
    expect(await service.searchPublishedContent('   ')).toEqual([]);
    expect(await service.searchPublishedContent(undefined)).toEqual([]);
    expect(repository.searchPublishedContent).toHaveBeenCalledOnce();
  });

  it('filters legacy search candidates before returning up to twenty canonical matches', async () => {
    const repository = createRepository();
    const invalidCandidates = Array.from({ length: 12 }, (_, index) =>
      publishedContent(`engineering/legacy-guide-${index}`, index),
    );
    const canonicalCandidates = Array.from({ length: 25 }, (_, index) =>
      publishedContent(
        `articles/architecture/canonical-guide-${index}`,
        index + invalidCandidates.length,
      ),
    );
    repository.searchPublishedContent.mockResolvedValue([
      ...invalidCandidates,
      ...canonicalCandidates,
    ]);
    const service = new ContentCatalogService(
      repository,
      createAuthorization(),
    );

    const results = await service.searchPublishedContent('guide');

    expect(repository.searchPublishedContent).toHaveBeenCalledWith(
      'guide',
      100,
    );
    expect(results).toEqual(canonicalCandidates.slice(0, 20));
    expect(results).toHaveLength(20);
  });

  it('rejects malformed and oversized public content queries', async () => {
    const repository = createRepository();
    const service = new ContentCatalogService(
      repository,
      createAuthorization(),
    );

    await expect(
      service.searchPublishedContent(['query']),
    ).rejects.toBeInstanceOf(ContentSearchValidationError);
    await expect(
      service.searchPublishedContent('x'.repeat(161)),
    ).rejects.toBeInstanceOf(ContentSearchValidationError);
    expect(repository.searchPublishedContent).not.toHaveBeenCalled();
  });

  it('builds the public catalog from the active snapshot and current published state', async () => {
    const catalogSnapshot = {
      schema_version: 1,
      site: {
        name: 'Stack Atlas',
        description: 'Engineering knowledge.',
        language: 'vi',
      },
      topics: [
        {
          id: 'architecture',
          title: 'Architecture',
          description: 'System boundaries.',
        },
      ],
      categories: [{ id: 'engineering', title: 'Engineering' }],
      paths: [
        {
          id: 'backend',
          title: 'Backend',
          description: 'Backend learning path.',
          legacyIndexUrls: [],
          modules: [
            {
              id: 'foundations',
              title: 'Foundations',
              order: 1,
              domain: 'architecture',
              category: 'engineering',
              articleIds: ['alpha', 'beta'],
              legacyIndexUrls: ['/season-01-fundamentals/index.html'],
            },
          ],
        },
      ],
      articles: [
        {
          sourceId: 'alpha',
          contentKey: 'article:alpha',
          domain: 'architecture',
          category: 'engineering',
          tags: [],
          difficulty: 'unspecified',
          learningPaths: [{ pathId: 'backend', moduleId: 'foundations' }],
          prerequisites: [],
          related: ['beta'],
          labs: [],
          authors: [],
          kubernetes: null,
          review: null,
          legacyUrls: ['/season-01-fundamentals/alpha.html'],
        },
        {
          sourceId: 'beta',
          contentKey: 'article:beta',
          domain: 'architecture',
          category: 'engineering',
          tags: [],
          difficulty: 'unspecified',
          learningPaths: [{ pathId: 'backend', moduleId: 'foundations' }],
          prerequisites: ['alpha'],
          related: ['alpha'],
          labs: [],
          authors: [],
          kubernetes: null,
          review: null,
          legacyUrls: ['/season-01-fundamentals/beta.html'],
        },
      ],
      redirects: [],
    } as const;
    const repository = createRepository();
    repository.findPublicContentCatalog.mockResolvedValue({
      sourceCommitSha: 'a'.repeat(40),
      checksumSha256: checksumContent(catalogSnapshot),
      createdAt: new Date('2026-10-03T00:00:00.000Z'),
      catalog: catalogSnapshot,
      publishedArticles: [
        {
          contentId: 'content-alpha',
          contentKey: 'article:alpha',
          slug: 'engineering/legacy-alpha',
          publishedRevisionId: 'revision-alpha',
          title: 'Legacy Alpha from published revision',
          description: 'Published description.',
          publishedAt: new Date('2026-10-02T00:00:00.000Z'),
        },
        {
          contentId: 'content-beta',
          contentKey: 'article:beta',
          slug: 'articles/architecture/beta',
          publishedRevisionId: 'revision-beta',
          title: 'Beta from published revision',
          description: 'Published description.',
          publishedAt: new Date('2026-10-02T00:00:00.000Z'),
        },
      ],
    });
    const service = new ContentCatalogService(
      repository,
      createAuthorization(),
    );

    const result = await service.getPublicContentCatalog();

    expect(result.articles).toHaveLength(1);
    expect(result.articles[0]).toMatchObject({
      sourceId: 'beta',
      title: 'Beta from published revision',
      url: '/articles/architecture/beta/',
      prerequisites: [],
      related: [],
    });
    expect(result.paths[0]?.modules[0]?.articleIds).toEqual(['beta']);
    expect(result.redirects).toContainEqual({
      source: '/season-01-fundamentals/beta.html',
      destination: '/articles/architecture/beta/',
      kind: 'article',
    });
    expect(result.redirects).not.toContainEqual(
      expect.objectContaining({
        source: '/season-01-fundamentals/alpha.html',
      }),
    );
  });

  it('reports catalog service unavailability before the first verified import', async () => {
    const repository = createRepository();
    repository.findPublicContentCatalog.mockResolvedValue(null);
    const service = new ContentCatalogService(
      repository,
      createAuthorization(),
    );

    await expect(service.getPublicContentCatalog()).rejects.toBeInstanceOf(
      ContentCatalogNotReadyError,
    );
  });

  it('rejects an active catalog snapshot whose checksum does not match its content', async () => {
    const repository = createRepository();
    repository.findPublicContentCatalog.mockResolvedValue({
      sourceCommitSha: 'a'.repeat(40),
      checksumSha256: '0'.repeat(64),
      createdAt: new Date('2026-10-03T00:00:00.000Z'),
      catalog: {
        schema_version: 1,
        site: { name: 'Stack Atlas', description: 'Catalog.', language: 'vi' },
        topics: [],
        categories: [],
        paths: [],
        articles: [],
        redirects: [],
      },
      publishedArticles: [],
    });
    const service = new ContentCatalogService(
      repository,
      createAuthorization(),
    );

    await expect(service.getPublicContentCatalog()).rejects.toBeInstanceOf(
      ContentCatalogSnapshotConflictError,
    );
  });

  it('applies the explicit transition matrix and rejects transitions from the wrong state', async () => {
    const repository = createRepository();
    const authorization = createAuthorization();
    const service = new ContentCatalogService(repository, authorization);
    repository.findLifecycle.mockResolvedValue(lifecycle('DRAFT'));
    repository.transitionStatus.mockResolvedValue(lifecycle('IN_REVIEW'));

    await service.submitForReview('content-1', principal);

    expect(repository.transitionStatus).toHaveBeenCalledWith({
      contentId: 'content-1',
      expectedStatus: CONTENT_STATUS.DRAFT,
      nextStatus: CONTENT_STATUS.IN_REVIEW,
      actorAccountId: principal.accountId,
    });
    repository.findLifecycle.mockResolvedValue(lifecycle('PUBLISHED'));
    await expect(
      service.submitForReview('content-1', principal),
    ).rejects.toBeInstanceOf(ContentLifecycleTransitionError);
    expect(repository.transitionStatus).toHaveBeenCalledOnce();
  });

  it('denies writes before repository access when the principal lacks permission', async () => {
    const repository = createRepository();
    const authorization = createAuthorization();
    authorization.hasPermissions.mockResolvedValue(false);
    const service = new ContentCatalogService(repository, authorization);

    await expect(
      service.createArticle(
        'article:reliable-systems',
        'articles/architecture/reliable-systems',
        document,
        principal,
      ),
    ).rejects.toBeInstanceOf(ContentPermissionDeniedError);
    expect(repository.createArticle).not.toHaveBeenCalled();
  });

  it('creates a published Git import with all required permissions and actor attribution', async () => {
    const repository = createRepository();
    const authorization = createAuthorization();
    const service = new ContentCatalogService(repository, authorization);
    repository.createPublishedArticle.mockResolvedValue({} as never);

    await service.createPublishedGitImportArticle(
      {
        contentKey: 'article:reliable-systems',
        slug: 'articles/architecture/reliable-systems',
        document,
      },
      principal,
    );

    expect(authorization.hasPermissions).toHaveBeenCalledWith(principal, [
      PLATFORM_PERMISSION.CONTENT_CREATE,
      PLATFORM_PERMISSION.CONTENT_UPDATE,
      PLATFORM_PERMISSION.CONTENT_PUBLISH,
    ]);
    expect(repository.createPublishedArticle).toHaveBeenCalledWith({
      contentKey: 'article:reliable-systems',
      slug: 'articles/architecture/reliable-systems',
      actorAccountId: principal.accountId,
      document,
      checksumSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
  });

  it('produces the same checksum when JSON object keys are ordered differently', async () => {
    const repository = createRepository();
    const service = new ContentCatalogService(
      repository,
      createAuthorization(),
    );
    await service.createArticle(
      'article:reliable-systems',
      'articles/architecture/reliable-systems',
      document,
      principal,
    );
    await service.createArticle(
      'article:another-key',
      'articles/architecture/another-key',
      {
        blocks: document.blocks,
        description: document.description,
        title: document.title,
        schema_version: document.schema_version,
      },
      principal,
    );

    const firstChecksum =
      repository.createArticle.mock.calls[0]?.[0].checksumSha256;
    const secondChecksum =
      repository.createArticle.mock.calls[1]?.[0].checksumSha256;
    expect(firstChecksum).toBe(secondChecksum);
  });
});
