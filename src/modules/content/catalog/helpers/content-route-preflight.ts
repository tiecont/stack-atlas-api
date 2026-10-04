import type {
  ContentArticleRouteAuditRow,
  ContentArticleRouteCollision,
  ContentArticleRoutePreflightItem,
  ContentArticleRoutePreflightReport,
} from '../types/content-catalog.types';
import { classifyArticleRouteSlug } from '../types/content-slug';

export function buildArticleRoutePreflightReport(
  rows: readonly ContentArticleRouteAuditRow[],
): ContentArticleRoutePreflightReport {
  const items = rows
    .map((row): ContentArticleRoutePreflightItem => {
      const route = classifyArticleRouteSlug(row.slug);
      return {
        ...row,
        archivedAt: row.archivedAt?.toISOString() ?? null,
        classification: route.classification,
        reason: route.reason,
        severity: route.classification === 'canonical' ? 'INFO' : 'BLOCKER',
        suggestion: route.suggestedSlug
          ? { slug: route.suggestedSlug, authoritative: false }
          : null,
      };
    })
    .sort((left, right) => left.contentId.localeCompare(right.contentId));

  const suggestions = new Map<string, ContentArticleRoutePreflightItem[]>();
  for (const item of items) {
    if (!item.suggestion) continue;
    const candidates = suggestions.get(item.suggestion.slug) ?? [];
    candidates.push(item);
    suggestions.set(item.suggestion.slug, candidates);
  }

  const canonicalOwners = new Map<string, ContentArticleRoutePreflightItem[]>();
  for (const item of items) {
    if (item.classification !== 'canonical') continue;
    const owners = canonicalOwners.get(item.slug) ?? [];
    owners.push(item);
    canonicalOwners.set(item.slug, owners);
  }

  const suggestionCollisions: ContentArticleRouteCollision[] = [];
  for (const [suggestedSlug, candidates] of suggestions) {
    const candidateIds = candidates
      .map((candidate) => candidate.contentId)
      .sort();
    const owners = (canonicalOwners.get(suggestedSlug) ?? []).filter(
      (owner) => !candidateIds.includes(owner.contentId),
    );
    if (candidates.length > 1) {
      suggestionCollisions.push({
        kind: 'multiple_suggested_routes',
        suggestedSlug,
        severity: 'BLOCKER',
        candidateContentIds: candidateIds,
        ownerContentIds: [],
      });
    }

    const activeOwners = owners.filter(
      (owner) => owner.archivedAt === null && owner.status !== 'ARCHIVED',
    );
    if (activeOwners.length > 0) {
      suggestionCollisions.push({
        kind: 'active_canonical_route_owner',
        suggestedSlug,
        severity: 'BLOCKER',
        candidateContentIds: candidateIds,
        ownerContentIds: activeOwners.map((owner) => owner.contentId).sort(),
      });
    }

    const archivedOwners = owners.filter(
      (owner) => owner.archivedAt !== null || owner.status === 'ARCHIVED',
    );
    if (archivedOwners.length > 0) {
      suggestionCollisions.push({
        kind: 'archived_canonical_route_owner',
        suggestedSlug,
        severity: 'WARNING',
        candidateContentIds: candidateIds,
        ownerContentIds: archivedOwners.map((owner) => owner.contentId).sort(),
      });
    }
  }
  suggestionCollisions.sort(
    (left, right) =>
      left.suggestedSlug.localeCompare(right.suggestedSlug) ||
      left.kind.localeCompare(right.kind),
  );

  const invalidItems = items.filter(
    (item) => item.classification === 'invalid_route',
  );
  const blockerCollisions = suggestionCollisions.filter(
    (collision) => collision.severity === 'BLOCKER',
  );
  const warningCollisions = suggestionCollisions.filter(
    (collision) => collision.severity === 'WARNING',
  );

  return {
    schemaVersion: 1,
    summary: {
      totalArticles: items.length,
      canonical: items.length - invalidItems.length,
      invalid: invalidItems.length,
      activeInvalid: invalidItems.filter(
        (item) => item.archivedAt === null && item.status !== 'ARCHIVED',
      ).length,
      publishedInvalid: invalidItems.filter(
        (item) => item.status === 'PUBLISHED',
      ).length,
      draftReviewInvalid: invalidItems.filter(
        (item) => item.status === 'DRAFT' || item.status === 'IN_REVIEW',
      ).length,
      archivedInvalid: invalidItems.filter(
        (item) => item.archivedAt !== null || item.status === 'ARCHIVED',
      ).length,
      suggestionCollisions: suggestionCollisions.length,
      blockers: invalidItems.length + blockerCollisions.length,
      warnings: warningCollisions.length,
    },
    rows: items,
    suggestionCollisions,
  };
}
