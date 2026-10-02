import { describe, expect, it, vi } from 'vitest';
import { checksumContent } from '../../../src/modules/content/catalog/helpers/content-checksum.js';
import type { ContentCatalogService } from '../../../src/modules/content/catalog/services/content-catalog.service.js';
import { GitContentImportService } from '../../../src/modules/content/catalog/services/git-content-import.service.js';
import type { AuthenticatedPrincipal } from '../../../src/modules/identity/authentication/types/authenticated-principal.js';
import type { ContentDocumentV1 } from '../../../src/modules/content/catalog/types/content-document.js';
import type {
  GitContentSnapshot,
  GitContentSourceArticle,
} from '../../../src/modules/content/catalog/types/git-content-import.types.js';

const principal: AuthenticatedPrincipal = {
  accountId: '20000000-0000-4000-8000-000000000001',
  sessionId: '30000000-0000-4000-8000-000000000001',
  email: 'import-operator@example.test',
};

const document: ContentDocumentV1 = {
  schema_version: 1,
  title: 'Stable article',
  description: 'Imported from a fixed snapshot.',
  blocks: [
    {
      id: 'b-000000000000000000000000',
      type: 'rich_text',
      version: 1,
      props: {
        nodes: [
          {
            type: 'paragraph',
            children: [{ type: 'text', text: 'A stable body.' }],
          },
        ],
      },
    },
  ],
};

describe('GitContentImportService', () => {
  it('dry-runs without writes and reports source relationship and conversion gaps', async () => {
    const catalog = createCatalog();
    const service = new GitContentImportService(catalog);

    const report = await service.run(snapshot(), 'dry-run', principal);

    expect(report.summary).toMatchObject({
      discovered: 1,
      importable: 1,
      imported: 0,
      skipped: 0,
      failed: 0,
      unsupportedConstructs: 1,
      relationshipMismatches: 7,
    });
    expect(report.articles[0]?.status).toBe('ready');
    expect(catalog.authorizeGitContentImport).toHaveBeenCalledWith(false, principal);
    expect(catalog.createPublishedGitImportArticle).not.toHaveBeenCalled();
  });

  it('applies each missing article and verifies the resulting published state', async () => {
    const catalog = createCatalog();
    catalog.findGitImportState
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(importedState());
    const service = new GitContentImportService(catalog);

    const report = await service.run(snapshot(), 'apply', principal);

    expect(report.articles[0]?.status).toBe('imported');
    expect(report.summary.imported).toBe(1);
    expect(catalog.authorizeGitContentImport).toHaveBeenCalledWith(true, principal);
    expect(catalog.createPublishedGitImportArticle).toHaveBeenCalledWith(
      {
        contentKey: 'article:stable-article',
        slug: 'articles/architecture/stable-article',
        document,
      },
      principal,
    );
  });

  it('treats an identical existing publication as an idempotent no-op', async () => {
    const catalog = createCatalog();
    catalog.findGitImportState.mockResolvedValue(importedState());
    const service = new GitContentImportService(catalog);

    const report = await service.run(snapshot(), 'apply', principal);

    expect(report.articles[0]?.status).toBe('already_imported');
    expect(report.summary.imported).toBe(0);
    expect(catalog.createPublishedGitImportArticle).not.toHaveBeenCalled();
  });

  it('detects changed existing content before apply and makes no writes', async () => {
    const catalog = createCatalog();
    catalog.findGitImportState.mockResolvedValue({
      ...importedState(),
      slug: 'articles/another-route',
    });
    const service = new GitContentImportService(catalog);

    const report = await service.run(snapshot(), 'apply', principal);

    expect(report.articles[0]).toMatchObject({
      status: 'failed',
      message: expect.stringContaining('differs from the Git snapshot'),
    });
    expect(catalog.createPublishedGitImportArticle).not.toHaveBeenCalled();
  });

  it('blocks the whole preflight when any identity conflicts', async () => {
    const catalog = createCatalog();
    catalog.findGitImportState.mockResolvedValueOnce({
      ...importedState(),
      slug: 'articles/different',
    });
    const source = snapshot();
    source.articles.push({
      ...article(),
      sourceId: 'ready-article',
      contentKey: 'article:ready-article',
      slug: 'articles/architecture/ready-article',
    });
    const service = new GitContentImportService(catalog);

    const report = await service.run(source, 'apply', principal);

    expect(report.articles.map((result) => result.status)).toEqual([
      'failed',
      'skipped',
    ]);
    expect(catalog.createPublishedGitImportArticle).not.toHaveBeenCalled();
  });

  it('fails verification when the source article has not been imported', async () => {
    const catalog = createCatalog();
    const service = new GitContentImportService(catalog);

    const report = await service.run(snapshot(), 'verify', principal);

    expect(report.articles[0]).toMatchObject({
      status: 'failed',
      message: 'Content identity is not present in PostgreSQL.',
    });
    expect(catalog.createPublishedGitImportArticle).not.toHaveBeenCalled();
  });

  it('records dangling source relationship references without discarding them', async () => {
    const source = snapshot();
    const importedArticle = source.articles[0];
    const pathModule = source.pathRecords[0]?.modules[0];
    if (!importedArticle || !pathModule) {
      throw new Error('Expected relationship test fixtures.');
    }
    importedArticle.relationships.learningPaths = [
      { pathId: 'missing-path', moduleId: 'missing-module' },
    ];
    importedArticle.relationships.prerequisites = ['missing-article'];
    pathModule.articleIds.push('missing-article');

    const report = await new GitContentImportService(createCatalog()).run(
      source,
      'dry-run',
      principal,
    );

    expect(report.relationshipMismatches).toContainEqual(
      expect.objectContaining({
        relationship: 'path_membership',
        sourceValue: expect.objectContaining({
          unresolvedPath: true,
          unresolvedModule: false,
        }),
      }),
    );
    expect(report.relationshipMismatches).toContainEqual(
      expect.objectContaining({
        relationship: 'prerequisite',
        sourceValue: {
          articleIds: ['missing-article'],
          unresolvedArticleIds: ['missing-article'],
        },
      }),
    );
    expect(report.relationshipMismatches).toContainEqual(
      expect.objectContaining({
        relationship: 'path_membership',
        sourceValue: expect.objectContaining({
          unresolvedArticleIds: ['missing-article'],
        }),
      }),
    );
  });
});

function createCatalog() {
  return {
    authorizeGitContentImport: vi.fn().mockResolvedValue(undefined),
    findGitImportState: vi.fn().mockResolvedValue(null),
    createPublishedGitImportArticle: vi.fn().mockResolvedValue({}),
  } satisfies Pick<
    ContentCatalogService,
    | 'authorizeGitContentImport'
    | 'findGitImportState'
    | 'createPublishedGitImportArticle'
  >;
}

function article(): GitContentSourceArticle {
  return {
    sourceId: 'stable-article',
    contentKey: 'article:stable-article',
    slug: 'articles/architecture/stable-article',
    title: 'Stable article',
    description: 'Imported from a fixed snapshot.',
    sourceStatus: 'published',
    document,
    sourceFiles: [
      'content/articles/architecture/stable-article/article.yaml',
      'content/articles/architecture/stable-article/article.html',
    ],
    sourceChecksumSha256: 'a'.repeat(64),
    relationships: {
      domain: 'architecture',
      category: 'architecture',
      tags: ['systems'],
      authors: ['tiecont'],
      difficulty: 'unspecified',
      labs: [],
      kubernetes: null,
      review: null,
      learningPaths: [{ pathId: 'backend', moduleId: 'foundations' }],
      prerequisites: [],
      related: [],
      legacyUrls: ['/old/stable-article.html'],
    },
    warnings: [
      {
        code: 'svg_diagram_preserved_as_code',
        message: 'SVG source was preserved as code.',
        sourcePath: 'content/articles/architecture/stable-article/article.html',
      },
    ],
    errors: [],
  };
}

function snapshot(): GitContentSnapshot {
  return {
    repository: 'tiecont/stack-atlas',
    commitSha: '0'.repeat(40),
    sourceRoot: '/tmp/web-source',
    inventory: [
      {
        path: 'content/articles/architecture/stable-article/article.yaml',
        sha256: 'b'.repeat(64),
      },
    ],
    articles: [article()],
    pathRecords: [
      {
        id: 'backend',
        sourcePath: 'content/paths/backend.yaml',
        sourceMetadata: { title: 'Backend' },
        modules: [
          {
            id: 'foundations',
            order: 1,
            articleIds: ['stable-article'],
            sourceMetadata: {
              legacy_index_urls: ['/backend/foundations/index.html'],
            },
          },
        ],
        legacyIndexUrls: [],
      },
    ],
    sourceErrors: [],
  };
}

function importedState() {
  return {
    contentId: '40000000-0000-4000-8000-000000000001',
    contentKey: 'article:stable-article',
    slug: 'articles/architecture/stable-article',
    status: 'PUBLISHED' as const,
    latestRevisionId: '50000000-0000-4000-8000-000000000001',
    publishedRevisionId: '50000000-0000-4000-8000-000000000001',
    latestRevisionChecksumSha256: checksumContent(document),
  };
}
