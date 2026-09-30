import { describe, expect, it, vi } from 'vitest';
import { ContentCatalogService } from './content-catalog.service';
import { ContentDocumentValidationError } from '../types/content-document';
import type { ContentCatalogRepository } from '../repositories/content-catalog.repository';

const document = {
  schema_version: 1,
  title: 'Reliable systems',
  description: 'A short guide.',
  blocks: [
    { type: 'paragraph', text: 'Transactions make state changes durable.' },
    { type: 'heading', level: 2, id: 'trade-offs', text: 'Trade-offs' },
    { type: 'code', language: 'sql', code: 'COMMIT;' },
    { type: 'list', ordered: false, items: ['Safety', 'Liveness'] },
    {
      type: 'callout',
      tone: 'info',
      title: 'Note',
      text: 'Keep the contract versioned.',
    },
    { type: 'quote', text: 'Make state explicit.', attribution: 'Stack Atlas' },
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
        blocks: [{ type: 'html', value: '<script>bad()</script>' }],
      }),
    ).toThrow(ContentDocumentValidationError);
    expect(repository.createArticle).not.toHaveBeenCalled();

    expect(() =>
      service.createArticle('article:reliable-systems', {
        ...document,
        blocks: [{ type: 'paragraph', text: 'Content', html: '<b>extra</b>' }],
      }),
    ).toThrow('document.blocks[0].html is not supported.');
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
