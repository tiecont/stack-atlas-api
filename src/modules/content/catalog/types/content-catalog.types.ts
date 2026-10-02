import type { ContentDocumentV1 } from './content-document';

export const CONTENT_STATUS = {
  DRAFT: 'DRAFT',
  IN_REVIEW: 'IN_REVIEW',
  PUBLISHED: 'PUBLISHED',
  ARCHIVED: 'ARCHIVED',
} as const;

export type ContentStatus =
  (typeof CONTENT_STATUS)[keyof typeof CONTENT_STATUS];

export interface ContentLifecycleRecord {
  contentId: string;
  contentKey: string;
  slug: string;
  status: ContentStatus;
  latestRevisionId: string | null;
  publishedRevisionId: string | null;
  createdBy: string | null;
  archivedAt: Date | null;
  archivedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ContentRevisionRecord {
  contentId: string;
  contentKey: string;
  slug: string;
  status: ContentStatus;
  contentType: 'article';
  createdBy: string | null;
  revisionCreatedBy: string | null;
  revisionId: string;
  revisionNumber: number;
  schemaVersion: 1;
  checksumSha256: string;
  document: ContentDocumentV1;
  createdAt: Date;
  publishedAt?: Date | null;
  publishedBy?: string | null;
}

export interface PublishedContentRecord extends ContentRevisionRecord {
  publishedAt: Date;
  publishedBy: string | null;
}

export interface ContentRevisionSummary {
  contentId: string;
  revisionId: string;
  revisionNumber: number;
  checksumSha256: string;
  revisionCreatedBy: string | null;
  createdAt: Date;
  publishedAt: Date | null;
  publishedBy: string | null;
}

export interface ContentListCursor {
  createdAt: string;
  contentId: string;
}

export interface ContentListResult {
  items: ContentLifecycleRecord[];
  hasMore: boolean;
  nextCursor: ContentListCursor | null;
}

export interface ContentRevisionListResult {
  items: ContentRevisionSummary[];
  hasMore: boolean;
  nextCursor: number | null;
}

export interface CreateContentArticle {
  contentKey: string;
  slug: string;
  actorAccountId: string;
  document: ContentDocumentV1;
  checksumSha256: string;
}

export interface ContentImportState {
  contentId: string;
  contentKey: string;
  slug: string;
  status: ContentStatus;
  latestRevisionId: string | null;
  publishedRevisionId: string | null;
  latestRevisionChecksumSha256: string | null;
}

export interface CreateContentRevision {
  contentId: string;
  baseRevisionId: string;
  actorAccountId: string;
  document: ContentDocumentV1;
  checksumSha256: string;
}

export interface PublishContentRevision {
  contentId: string;
  revisionId: string;
  expectedStatus: ContentStatus;
  actorAccountId: string;
}

export interface TransitionContentStatus {
  contentId: string;
  expectedStatus: ContentStatus;
  nextStatus: ContentStatus;
  actorAccountId: string;
}

export class ContentIdentityConflictError extends Error {
  constructor() {
    super('A content item with this content_key already exists.');
    this.name = 'ContentIdentityConflictError';
  }
}

export class ContentSlugConflictError extends Error {
  constructor() {
    super('A non-archived content item already uses this slug.');
    this.name = 'ContentSlugConflictError';
  }
}

export class ContentItemNotFoundError extends Error {
  constructor() {
    super('The content item was not found.');
    this.name = 'ContentItemNotFoundError';
  }
}

export class ContentLifecycleTransitionError extends Error {
  constructor() {
    super('The requested content lifecycle transition is not allowed.');
    this.name = 'ContentLifecycleTransitionError';
  }
}

export class ContentLifecycleConflictError extends Error {
  constructor() {
    super('The content lifecycle changed before this operation completed.');
    this.name = 'ContentLifecycleConflictError';
  }
}

export class ContentPermissionDeniedError extends Error {
  constructor() {
    super('The authenticated principal lacks the required content permission.');
    this.name = 'ContentPermissionDeniedError';
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
