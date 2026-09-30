import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { AuthenticatedPrincipal } from '../../../identity/authentication/types/authenticated-principal';
import { PLATFORM_PERMISSION } from '../../../identity/platform-authorization/constants/platform-permissions';
import type { PlatformPermission } from '../../../identity/platform-authorization/constants/platform-permissions';
import { PlatformAuthorizationService } from '../../../identity/platform-authorization/services/platform-authorization.service';
import { ContentCatalogRepository } from '../repositories/content-catalog.repository';
import type {
  ContentLifecycleRecord,
  ContentRevisionRecord,
  PublishedContentRecord,
  ContentStatus,
} from '../types/content-catalog.types';
import {
  CONTENT_STATUS,
  ContentItemNotFoundError,
  ContentLifecycleTransitionError,
  ContentPermissionDeniedError,
  ContentRevisionNotFoundError,
} from '../types/content-catalog.types';
import {
  validateContentDocument,
  validateContentKey,
} from '../types/content-document';
import { normalizeContentSlug } from '../types/content-slug';

type ContentCatalogStore = Pick<
  ContentCatalogRepository,
  | 'createArticle'
  | 'appendRevision'
  | 'findRevision'
  | 'publishRevision'
  | 'findPublishedByKey'
  | 'findLifecycle'
  | 'transitionStatus'
>;

type PlatformAuthorization = Pick<
  PlatformAuthorizationService,
  'hasPermissions'
>;

const ALLOWED_TRANSITIONS: Readonly<
  Record<ContentStatus, readonly ContentStatus[]>
> = {
  DRAFT: [CONTENT_STATUS.IN_REVIEW, CONTENT_STATUS.ARCHIVED],
  IN_REVIEW: [
    CONTENT_STATUS.DRAFT,
    CONTENT_STATUS.PUBLISHED,
    CONTENT_STATUS.ARCHIVED,
  ],
  PUBLISHED: [CONTENT_STATUS.DRAFT, CONTENT_STATUS.ARCHIVED],
  ARCHIVED: [CONTENT_STATUS.DRAFT],
};

@Injectable()
export class ContentCatalogService {
  constructor(
    @Inject(ContentCatalogRepository)
    private readonly repository: ContentCatalogStore,
    @Inject(PlatformAuthorizationService)
    private readonly authorization: PlatformAuthorization,
  ) {}

  async createArticle(
    contentKey: string,
    slug: unknown,
    document: unknown,
    principal: AuthenticatedPrincipal,
  ): Promise<ContentRevisionRecord> {
    await this.requirePermission(principal, PLATFORM_PERMISSION.CONTENT_CREATE);
    const validatedKey = validateContentKey(contentKey);
    const validatedSlug = normalizeContentSlug(slug);
    const validatedDocument = validateContentDocument(document);
    return this.repository.createArticle({
      contentKey: validatedKey,
      slug: validatedSlug,
      actorAccountId: principal.accountId,
      document: validatedDocument,
      checksumSha256: checksum(validatedDocument),
    });
  }

  async appendRevision(
    contentId: string,
    baseRevisionId: string,
    document: unknown,
    principal: AuthenticatedPrincipal,
  ): Promise<ContentRevisionRecord> {
    await this.requirePermission(principal, PLATFORM_PERMISSION.CONTENT_UPDATE);
    if (!baseRevisionId.trim()) {
      throw new TypeError('baseRevisionId is required.');
    }
    const validatedDocument = validateContentDocument(document);
    return this.repository.appendRevision({
      contentId,
      baseRevisionId,
      actorAccountId: principal.accountId,
      document: validatedDocument,
      checksumSha256: checksum(validatedDocument),
    });
  }

  async publishRevision(
    contentId: string,
    revisionId: string,
    principal: AuthenticatedPrincipal,
  ): Promise<PublishedContentRecord> {
    await this.requirePermission(
      principal,
      PLATFORM_PERMISSION.CONTENT_PUBLISH,
    );
    const item = await this.repository.findLifecycle(contentId);
    if (!item) throw new ContentItemNotFoundError();
    assertAllowedTransition(item.status, CONTENT_STATUS.PUBLISHED);
    const revision = await this.repository.findRevision(contentId, revisionId);
    if (!revision) throw new ContentRevisionNotFoundError();
    validateContentDocument(revision.document);
    return this.repository.publishRevision({
      contentId,
      revisionId,
      expectedStatus: item.status,
    });
  }

  submitForReview(
    contentId: string,
    principal: AuthenticatedPrincipal,
  ): Promise<ContentLifecycleRecord> {
    return this.transitionTo(
      contentId,
      CONTENT_STATUS.IN_REVIEW,
      PLATFORM_PERMISSION.CONTENT_UPDATE,
      principal,
    );
  }

  returnToDraft(
    contentId: string,
    principal: AuthenticatedPrincipal,
  ): Promise<ContentLifecycleRecord> {
    return this.transitionTo(
      contentId,
      CONTENT_STATUS.DRAFT,
      PLATFORM_PERMISSION.CONTENT_UPDATE,
      principal,
    );
  }

  startDraft(
    contentId: string,
    principal: AuthenticatedPrincipal,
  ): Promise<ContentLifecycleRecord> {
    return this.transitionTo(
      contentId,
      CONTENT_STATUS.DRAFT,
      PLATFORM_PERMISSION.CONTENT_UPDATE,
      principal,
    );
  }

  archiveContent(
    contentId: string,
    principal: AuthenticatedPrincipal,
  ): Promise<ContentLifecycleRecord> {
    return this.transitionTo(
      contentId,
      CONTENT_STATUS.ARCHIVED,
      PLATFORM_PERMISSION.CONTENT_ARCHIVE,
      principal,
    );
  }

  restoreArchivedContent(
    contentId: string,
    principal: AuthenticatedPrincipal,
  ): Promise<ContentLifecycleRecord> {
    return this.transitionTo(
      contentId,
      CONTENT_STATUS.DRAFT,
      PLATFORM_PERMISSION.CONTENT_ARCHIVE,
      principal,
    );
  }

  findPublishedByKey(
    contentKey: string,
  ): Promise<PublishedContentRecord | null> {
    return this.repository.findPublishedByKey(validateContentKey(contentKey));
  }

  private async transitionTo(
    contentId: string,
    nextStatus: ContentStatus,
    permission: PlatformPermission,
    principal: AuthenticatedPrincipal,
  ): Promise<ContentLifecycleRecord> {
    await this.requirePermission(principal, permission);
    const item = await this.repository.findLifecycle(contentId);
    if (!item) throw new ContentItemNotFoundError();
    assertAllowedTransition(item.status, nextStatus);
    return this.repository.transitionStatus({
      contentId,
      expectedStatus: item.status,
      nextStatus,
      actorAccountId: principal.accountId,
    });
  }

  private async requirePermission(
    principal: AuthenticatedPrincipal,
    permission: PlatformPermission,
  ): Promise<void> {
    if (!(await this.authorization.hasPermissions(principal, [permission]))) {
      throw new ContentPermissionDeniedError();
    }
  }
}

function assertAllowedTransition(
  currentStatus: ContentStatus,
  nextStatus: ContentStatus,
): void {
  if (!ALLOWED_TRANSITIONS[currentStatus].includes(nextStatus)) {
    throw new ContentLifecycleTransitionError();
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
