import { describe, expect, it, vi } from 'vitest';
import { PLATFORM_PERMISSION } from '../../../identity/platform-authorization/constants/platform-permissions';
import type { PlatformAuthorizationService } from '../../../identity/platform-authorization/services/platform-authorization.service';
import { ContentCatalogService } from './content-catalog.service';
import type { ContentCatalogRepository } from '../repositories/content-catalog.repository';
import {
  CONTENT_STATUS,
  ContentLifecycleTransitionError,
  ContentPermissionDeniedError,
} from '../types/content-catalog.types';
import { ContentDocumentValidationError } from '../types/content-document';
import type { AuthenticatedPrincipal } from '../../../identity/authentication/types/authenticated-principal';

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
    appendRevision: vi.fn(),
    findRevision: vi.fn(),
    publishRevision: vi.fn(),
    findPublishedByKey: vi.fn(),
    findPublishedBySlug: vi.fn(),
    findLifecycle: vi.fn(),
    transitionStatus: vi.fn(),
    listContent: vi.fn(),
    listRevisions: vi.fn(),
  } satisfies Pick<
    ContentCatalogRepository,
    | 'createArticle'
    | 'createPublishedArticle'
    | 'findImportStateByKey'
    | 'appendRevision'
    | 'findRevision'
    | 'publishRevision'
    | 'findPublishedByKey'
    | 'findPublishedBySlug'
    | 'findLifecycle'
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
    slug: 'reliable-systems',
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

describe('ContentCatalogService', () => {
  it('normalizes slug and attributes item and first revision to the authenticated principal', async () => {
    const repository = createRepository();
    const authorization = createAuthorization();
    const service = new ContentCatalogService(repository, authorization);

    await service.createArticle(
      'article:reliable-systems',
      '  Reliable   Systems  ',
      document,
      principal,
    );

    expect(authorization.hasPermissions).toHaveBeenCalledWith(principal, [
      PLATFORM_PERMISSION.CONTENT_CREATE,
    ]);
    expect(repository.createArticle).toHaveBeenCalledWith({
      contentKey: 'article:reliable-systems',
      slug: 'reliable-systems',
      actorAccountId: principal.accountId,
      document,
      checksumSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
  });

  it('rejects reserved slugs and invalid documents before persistence', async () => {
    const repository = createRepository();
    const service = new ContentCatalogService(
      repository,
      createAuthorization(),
    );

    await expect(
      service.createArticle(
        'article:reliable-systems',
        'admin/posts',
        document,
        principal,
      ),
    ).rejects.toThrow('reserved route segment');
    await expect(
      service.createArticle(
        'article:reliable-systems',
        'reliable-systems',
        { ...document, blocks: [{ type: 'paragraph' }] },
        principal,
      ),
    ).rejects.toBeInstanceOf(ContentDocumentValidationError);
    expect(repository.createArticle).not.toHaveBeenCalled();
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
        'reliable-systems',
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
        slug: 'articles/reliable-systems',
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
      slug: 'articles/reliable-systems',
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
      'reliable-systems',
      document,
      principal,
    );
    await service.createArticle(
      'article:another-key',
      'another-key',
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
