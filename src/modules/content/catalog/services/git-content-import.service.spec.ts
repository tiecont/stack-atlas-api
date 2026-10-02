import { describe, expect, it, vi } from 'vitest';
import type { ContentCatalogService } from './content-catalog.service';
import { GitContentImportService } from './git-content-import.service';
import type { AuthenticatedPrincipal } from '../../../identity/authentication/types/authenticated-principal';
import type { GitContentSnapshot } from '../types/git-content-import.types';

const principal: AuthenticatedPrincipal = {
  accountId: '20000000-0000-4000-8000-000000000001',
  sessionId: '30000000-0000-4000-8000-000000000001',
  email: 'import-operator@example.test',
};

describe('GitContentImportService', () => {
  it('reports invalid snapshot articles without accessing the catalog', async () => {
    const catalog = {
      authorizeGitContentImport: vi.fn().mockResolvedValue(undefined),
      findGitImportState: vi.fn(),
      createPublishedGitImportArticle: vi.fn(),
    } satisfies Pick<
      ContentCatalogService,
      | 'authorizeGitContentImport'
      | 'findGitImportState'
      | 'createPublishedGitImportArticle'
    >;
    const service = new GitContentImportService(catalog);
    const snapshot: GitContentSnapshot = {
      repository: 'tiecont/stack-atlas',
      commitSha: 'a'.repeat(40),
      sourceRoot: '/tmp/source',
      inventory: [],
      articles: [
        {
          sourceId: 'invalid',
          contentKey: 'article:invalid',
          slug: 'articles/invalid',
          title: 'Invalid source',
          description: 'Invalid source fixture.',
          sourceStatus: 'published',
          document: null,
          sourceFiles: ['content/articles/invalid/article.html'],
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
          errors: [
            {
              code: 'invalid_content_document',
              message: 'Unsupported source structure.',
              sourcePath: 'content/articles/invalid/article.html',
            },
          ],
        },
      ],
      pathRecords: [],
      sourceErrors: [],
    };

    const report = await service.run(snapshot, 'dry-run', principal);

    expect(report.summary.failed).toBe(1);
    expect(catalog.findGitImportState).not.toHaveBeenCalled();
    expect(catalog.createPublishedGitImportArticle).not.toHaveBeenCalled();
  });
});
