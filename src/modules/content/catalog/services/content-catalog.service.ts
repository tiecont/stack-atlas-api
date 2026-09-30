import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ContentCatalogRepository } from '../repositories/content-catalog.repository';
import type {
  ContentRevisionRecord,
  PublishedContentRecord,
} from '../types/content-catalog.types';
import { ContentRevisionNotFoundError } from '../types/content-catalog.types';
import {
  validateContentDocument,
  validateContentKey,
} from '../types/content-document';

type ContentCatalogStore = Pick<
  ContentCatalogRepository,
  | 'createArticle'
  | 'appendRevision'
  | 'findRevision'
  | 'publishRevision'
  | 'findPublishedByKey'
>;

@Injectable()
export class ContentCatalogService {
  constructor(
    @Inject(ContentCatalogRepository)
    private readonly repository: ContentCatalogStore,
  ) {}

  createArticle(
    contentKey: string,
    document: unknown,
  ): Promise<ContentRevisionRecord> {
    const validatedKey = validateContentKey(contentKey);
    const validatedDocument = validateContentDocument(document);
    return this.repository.createArticle({
      contentKey: validatedKey,
      document: validatedDocument,
      checksumSha256: checksum(validatedDocument),
    });
  }

  appendRevision(
    contentId: string,
    document: unknown,
  ): Promise<ContentRevisionRecord> {
    const validatedDocument = validateContentDocument(document);
    return this.repository.appendRevision({
      contentId,
      document: validatedDocument,
      checksumSha256: checksum(validatedDocument),
    });
  }

  async publishRevision(
    contentId: string,
    revisionId: string,
  ): Promise<PublishedContentRecord> {
    const revision = await this.repository.findRevision(contentId, revisionId);
    if (!revision) throw new ContentRevisionNotFoundError();
    validateContentDocument(revision.document);
    return this.repository.publishRevision({ contentId, revisionId });
  }

  findPublishedByKey(
    contentKey: string,
  ): Promise<PublishedContentRecord | null> {
    return this.repository.findPublishedByKey(validateContentKey(contentKey));
  }
}

function checksum(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex');
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => canonicalize(item));
  if (typeof value !== 'object' || value === null) return value;
  const entries = Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => [key, canonicalize(item)] as const);
  return Object.fromEntries(entries);
}
