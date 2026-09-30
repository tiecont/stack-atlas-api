import { describe, expect, it, vi } from 'vitest';
import { ContentCatalogService } from './content-catalog.service';
import { ContentDocumentValidationError } from '../types/content-document';
import type { ContentCatalogRepository } from '../repositories/content-catalog.repository';

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
    {
      id: 'notice',
      type: 'callout',
      version: 1,
      props: {
        tone: 'info',
        title: 'Note',
        text: 'Keep the contract versioned.',
      },
    },
  ],
};

function createRepository() {
  return {
    createArticle: vi.fn(),
    appendRevision: vi.fn(),
    findRevision: vi.fn(),
    publishRevision: vi.fn(),
    findPublishedByKey: vi.fn(),
  } satisfies Pick<
    ContentCatalogRepository,
    | 'createArticle'
    | 'appendRevision'
    | 'findRevision'
    | 'publishRevision'
    | 'findPublishedByKey'
  >;
}

describe('ContentCatalogService', () => {
  it('validates the versioned block document before creating an immutable revision', async () => {
    const repository = createRepository();
    const service = new ContentCatalogService(repository);

    await service.createArticle('article:reliable-systems', document);

    expect(repository.createArticle).toHaveBeenCalledWith({
      contentKey: 'article:reliable-systems',
      document,
      checksumSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
  });

  it('rejects unknown block types and fields before persistence', async () => {
    const repository = createRepository();
    const service = new ContentCatalogService(repository);

    expect(() =>
      service.createArticle('article:reliable-systems', {
        ...document,
        blocks: [
          {
            id: 'body',
            type: 'html',
            version: 1,
            props: { value: '<script>bad()</script>' },
          },
        ],
      }),
    ).toThrow(ContentDocumentValidationError);
    expect(repository.createArticle).not.toHaveBeenCalled();

    expect(() =>
      service.createArticle('article:reliable-systems', {
        ...document,
        blocks: [
          {
            id: 'body',
            type: 'rich_text',
            version: 1,
            props: { nodes: [], html: '<b>extra</b>' },
          },
        ],
      }),
    ).toThrow('document.blocks[0].props.html is not supported.');
  });

  it('requires and forwards the latest revision the caller edited', async () => {
    const repository = createRepository();
    const service = new ContentCatalogService(repository);
    repository.appendRevision.mockResolvedValue({} as never);

    await service.appendRevision('content-id', 'revision-12', document);

    expect(repository.appendRevision).toHaveBeenCalledWith({
      contentId: 'content-id',
      baseRevisionId: 'revision-12',
      document,
      checksumSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
  });

  it('produces the same checksum when JSON object keys are ordered differently', async () => {
    const repository = createRepository();
    const service = new ContentCatalogService(repository);
    await service.createArticle('article:reliable-systems', document);
    await service.createArticle('article:another-key', {
      blocks: document.blocks,
      description: document.description,
      title: document.title,
      schema_version: document.schema_version,
    });

    const firstChecksum =
      repository.createArticle.mock.calls[0]?.[0].checksumSha256;
    const secondChecksum =
      repository.createArticle.mock.calls[1]?.[0].checksumSha256;
    expect(firstChecksum).toBe(secondChecksum);
  });
});
