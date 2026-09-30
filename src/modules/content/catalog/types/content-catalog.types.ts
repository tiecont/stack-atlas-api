import type { ContentDocumentV1 } from './content-document';

export interface ContentRevisionRecord {
  contentId: string;
  contentKey: string;
  contentType: 'article';
  revisionId: string;
  revisionNumber: number;
  schemaVersion: 1;
  checksumSha256: string;
  document: ContentDocumentV1;
  createdAt: Date;
}

export interface PublishedContentRecord extends ContentRevisionRecord {
  publishedAt: Date;
}

export interface CreateContentArticle {
  contentKey: string;
  document: ContentDocumentV1;
  checksumSha256: string;
}

export interface CreateContentRevision {
  contentId: string;
  baseRevisionId: string;
  document: ContentDocumentV1;
  checksumSha256: string;
}

export interface PublishContentRevision {
  contentId: string;
  revisionId: string;
}

export class ContentIdentityConflictError extends Error {
  constructor() {
    super('A content item with this content_key already exists.');
    this.name = 'ContentIdentityConflictError';
  }
}

export class ContentItemNotFoundError extends Error {
  constructor() {
    super('The content item was not found.');
    this.name = 'ContentItemNotFoundError';
  }
}

export class ContentRevisionNotFoundError extends Error {
  constructor() {
    super('The content revision was not found for this content item.');
    this.name = 'ContentRevisionNotFoundError';
  }
}

export class ContentRevisionConflictError extends Error {
  constructor() {
    super(
      'The content revision changed before this revision could be appended.',
    );
    this.name = 'ContentRevisionConflictError';
  }
}
