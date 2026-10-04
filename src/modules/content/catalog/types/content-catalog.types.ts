import type { ContentDocumentV1 } from './content-document';
import type { ContentArticleRouteReason } from './content-slug';

export const CONTENT_STATUS = {
  DRAFT: 'DRAFT',
  IN_REVIEW: 'IN_REVIEW',
  PUBLISHED: 'PUBLISHED',
  ARCHIVED: 'ARCHIVED',
} as const;

export type ContentStatus =
  (typeof CONTENT_STATUS)[keyof typeof CONTENT_STATUS];

export type ContentRoutePreflightSeverity = 'BLOCKER' | 'WARNING' | 'INFO';

export interface ContentArticleRouteAuditRow {
  contentId: string;
  contentKey: string;
  contentType: 'article';
  slug: string;
  status: ContentStatus;
  archivedAt: Date | null;
  publishedRevisionId: string | null;
}

export interface ContentArticleRoutePreflightItem extends Omit<
  ContentArticleRouteAuditRow,
  'archivedAt'
> {
  archivedAt: string | null;
  classification: 'canonical' | 'invalid_route';
  reason: ContentArticleRouteReason;
  severity: ContentRoutePreflightSeverity;
  suggestion: { slug: string; authoritative: false } | null;
}

export type ContentArticleRouteCollisionKind =
  | 'multiple_suggested_routes'
  | 'active_canonical_route_owner'
  | 'archived_canonical_route_owner';

export interface ContentArticleRouteCollision {
  kind: ContentArticleRouteCollisionKind;
  suggestedSlug: string;
  severity: 'BLOCKER' | 'WARNING';
  candidateContentIds: string[];
  ownerContentIds: string[];
}

export interface ContentArticleRoutePreflightReport {
  schemaVersion: 1;
  summary: {
    totalArticles: number;
    canonical: number;
    invalid: number;
    activeInvalid: number;
    publishedInvalid: number;
    draftReviewInvalid: number;
    archivedInvalid: number;
    suggestionCollisions: number;
    blockers: number;
    warnings: number;
  };
  rows: ContentArticleRoutePreflightItem[];
  suggestionCollisions: ContentArticleRouteCollision[];
}

export interface ContentLifecycleRecord {
  contentId: string;
  contentKey: string;
  contentType: 'article';
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

export interface ContentCatalogSiteV1 {
  name: string;
  description: string;
  language: string;
}

export interface ContentCatalogTopicV1 {
  id: string;
  title: string;
  description: string;
  status?: string;
  icon?: string;
}

export interface ContentCatalogCategoryV1 {
  id: string;
  title: string;
}

export interface ContentCatalogPathModuleV1 {
  id: string;
  title: string;
  order: number;
  domain: string;
  category: string;
  group?: string;
  articleIds: string[];
  legacyIndexUrls: string[];
}

export interface ContentCatalogPathV1 {
  id: string;
  title: string;
  description: string;
  status?: string;
  domain?: string;
  difficulty?: { start: string; end: string };
  legacyIndexUrls: string[];
  modules: ContentCatalogPathModuleV1[];
}

export interface ContentCatalogArticleMetadataV1 {
  sourceId: string;
  contentKey: string;
  domain: string;
  category: string | null;
  tags: string[];
  difficulty: string;
  learningPaths: { pathId: string; moduleId: string }[];
  prerequisites: string[];
  related: string[];
  labs: string[];
  authors: string[];
  kubernetes: Record<string, unknown> | null;
  review: Record<string, unknown> | null;
  legacyUrls: string[];
}

export interface ContentCatalogRedirectV1 {
  source: string;
  destination: string;
  kind: 'article' | 'path-module';
}

export interface ContentCatalogSnapshotV1 {
  schema_version: 1;
  site: ContentCatalogSiteV1;
  topics: ContentCatalogTopicV1[];
  categories: ContentCatalogCategoryV1[];
  paths: ContentCatalogPathV1[];
  articles: ContentCatalogArticleMetadataV1[];
  redirects: ContentCatalogRedirectV1[];
}

export interface PublishedCatalogArticleV1 extends ContentCatalogArticleMetadataV1 {
  contentId: string;
  slug: string;
  title: string;
  description: string;
  publishedRevisionId: string;
  publishedAt: string;
  url: string;
}

export interface PublicContentCatalogRecord {
  schema_version: 1;
  sourceCommitSha: string;
  checksumSha256: string;
  createdAt: Date;
  site: ContentCatalogSiteV1;
  topics: ContentCatalogTopicV1[];
  categories: ContentCatalogCategoryV1[];
  paths: ContentCatalogPathV1[];
  articles: PublishedCatalogArticleV1[];
  redirects: ContentCatalogRedirectV1[];
}

export interface ContentCatalogImportState {
  sourceCommitSha: string;
  checksumSha256: string;
  isActive: boolean;
}

export interface PublishedCatalogContentState {
  contentId: string;
  contentKey: string;
  slug: string;
  publishedRevisionId: string;
  title: string;
  description: string;
  publishedAt: Date;
}

export interface StoredPublicContentCatalog {
  sourceCommitSha: string;
  checksumSha256: string;
  createdAt: Date;
  catalog: unknown;
  publishedArticles: PublishedCatalogContentState[];
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

export class ContentRouteNotPublishableError extends Error {
  constructor() {
    super('The content item does not have a canonical public article route.');
    this.name = 'ContentRouteNotPublishableError';
  }
}

export class ContentItemNotFoundError extends Error {
  constructor() {
    super('The content item was not found.');
    this.name = 'ContentItemNotFoundError';
  }
}

export class ContentSearchValidationError extends Error {
  constructor() {
    super(
      'The public content search query must be a string no longer than 160 characters.',
    );
    this.name = 'ContentSearchValidationError';
  }
}

export class ContentCatalogNotReadyError extends Error {
  constructor() {
    super('The public content catalog has not been imported.');
    this.name = 'ContentCatalogNotReadyError';
  }
}

export class ContentCatalogSnapshotConflictError extends Error {
  constructor() {
    super('The catalog snapshot for this source commit does not match.');
    this.name = 'ContentCatalogSnapshotConflictError';
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
