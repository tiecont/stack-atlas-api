import { StructuredProblemException } from '../../../../common/errors/problem-details';
import {
  ContentIdentityConflictError,
  ContentItemNotFoundError,
  ContentLifecycleConflictError,
  ContentLifecycleTransitionError,
  ContentPermissionDeniedError,
  ContentRevisionConflictError,
  ContentRevisionNotFoundError,
  ContentSearchValidationError,
  ContentSlugConflictError,
  ContentCatalogNotReadyError,
  ContentCatalogSnapshotConflictError,
  ContentRouteNotPublishableError,
  ContentRouteConflictError,
  ContentRouteRemediationRequiredError,
  ContentRouteReservedError,
} from '../types/content-catalog.types';
import { ContentDocumentValidationError } from '../types/content-document';
import {
  ContentArticleRouteValidationError,
  ContentSlugValidationError,
} from '../types/content-slug';
import { ContentCursorValidationError } from './content-pagination';

export async function withContentProblems<T>(
  operation: Promise<T>,
): Promise<T> {
  try {
    return await operation;
  } catch (error) {
    const problem = toContentProblem(error);
    if (problem) throw problem;
    throw error;
  }
}

function toContentProblem(error: unknown): StructuredProblemException | null {
  if (error instanceof ContentPermissionDeniedError) {
    return new StructuredProblemException(
      403,
      'content_permission_denied',
      'The current session does not have permission to perform this action.',
    );
  }
  if (error instanceof ContentItemNotFoundError) {
    return new StructuredProblemException(
      404,
      'content_not_found',
      'The requested content item was not found.',
    );
  }
  if (error instanceof ContentCatalogNotReadyError) {
    return new StructuredProblemException(
      503,
      'content_catalog_not_ready',
      'The public content catalog is not available yet.',
      true,
    );
  }
  if (error instanceof ContentCatalogSnapshotConflictError) {
    return new StructuredProblemException(
      503,
      'content_catalog_unavailable',
      'The public content catalog failed integrity validation.',
      true,
    );
  }
  if (error instanceof ContentRevisionNotFoundError) {
    return new StructuredProblemException(
      404,
      'content_revision_not_found',
      'The requested revision does not belong to this content item.',
    );
  }
  if (error instanceof ContentRevisionConflictError) {
    return new StructuredProblemException(
      409,
      'content_revision_conflict',
      'The base revision is stale. Fetch the latest revision before saving again.',
      true,
    );
  }
  if (error instanceof ContentLifecycleConflictError) {
    return new StructuredProblemException(
      409,
      'content_lifecycle_conflict',
      'The content lifecycle changed during this operation. Reload the content and retry.',
      true,
    );
  }
  if (error instanceof ContentLifecycleTransitionError) {
    return new StructuredProblemException(
      409,
      'content_lifecycle_transition_conflict',
      'The requested action is not allowed from the current content state.',
    );
  }
  if (error instanceof ContentRouteConflictError) {
    return new StructuredProblemException(
      409,
      'content_route_conflict',
      'The content route changed before this operation completed. Reload the content and retry.',
      true,
    );
  }
  if (error instanceof ContentRouteReservedError) {
    return new StructuredProblemException(
      409,
      'content_route_reserved',
      'Another current or historical content route already reserves this slug.',
    );
  }
  if (error instanceof ContentRouteRemediationRequiredError) {
    return new StructuredProblemException(
      409,
      'content_route_remediation_required',
      'This historical content route requires an approved remediation before it can be changed.',
    );
  }
  if (error instanceof ContentSlugConflictError) {
    return new StructuredProblemException(
      409,
      'content_slug_conflict',
      'Another active content item already uses this slug.',
    );
  }
  if (error instanceof ContentRouteNotPublishableError) {
    return new StructuredProblemException(
      409,
      'content_route_not_publishable',
      'The content item does not have a canonical public article route.',
    );
  }
  if (error instanceof ContentIdentityConflictError) {
    return new StructuredProblemException(
      409,
      'content_identity_conflict',
      'A content item with this identity already exists.',
    );
  }
  if (error instanceof ContentSearchValidationError) {
    return new StructuredProblemException(
      400,
      'invalid_content_search',
      'The search query must be a string no longer than 160 characters.',
    );
  }
  if (error instanceof ContentArticleRouteValidationError) {
    return new StructuredProblemException(
      400,
      'invalid_content_route',
      'The article route must match articles/<domain>/<slug>.',
    );
  }
  if (
    error instanceof ContentDocumentValidationError ||
    error instanceof ContentSlugValidationError ||
    error instanceof ContentCursorValidationError ||
    (error instanceof TypeError &&
      error.message === 'baseRevisionId is required.')
  ) {
    return new StructuredProblemException(
      400,
      'invalid_content_request',
      'The content request does not satisfy the Content Document V1 contract.',
    );
  }
  return null;
}
