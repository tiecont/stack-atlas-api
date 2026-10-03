import { describe, expect, it } from 'vitest';
import { buildArticleRoutePreflightReport } from '../../../src/modules/content/catalog/helpers/content-route-preflight.js';
import type { ContentArticleRouteAuditRow } from '../../../src/modules/content/catalog/types/content-catalog.types.js';

function articleRow(
  contentId: string,
  slug: string,
  options: {
    status?: ContentArticleRouteAuditRow['status'];
    archivedAt?: Date | null;
  } = {},
): ContentArticleRouteAuditRow {
  return {
    contentId,
    contentKey: 'article:' + contentId,
    contentType: 'article',
    slug,
    status: options.status ?? 'DRAFT',
    archivedAt: options.archivedAt ?? null,
    publishedRevisionId:
      options.status === 'PUBLISHED' ? 'revision-' + contentId : null,
  };
}

describe('content article route preflight', () => {
  it('classifies all rows and reports route suggestions and ownership collisions', () => {
    const archivedAt = new Date('2026-10-01T00:00:00.000Z');
    const report = buildArticleRoutePreflightReport([
      articleRow('canonical', 'articles/architecture/route-collision'),
      articleRow('archived-canonical', 'articles/architecture/restore-route', {
        status: 'ARCHIVED',
        archivedAt,
      }),
      articleRow('legacy-active-a', 'architecture/route-collision'),
      articleRow('legacy-archived-b', 'architecture/route-collision', {
        status: 'ARCHIVED',
        archivedAt,
      }),
      articleRow('legacy-restore', 'architecture/restore-route'),
      articleRow('generated', 'legacy-' + 'a'.repeat(32)),
      articleRow('wrong-count', 'articles/golang'),
      articleRow('bad-domain', 'articles/Architecture/route'),
      articleRow('bad-slug', 'articles/golang/route_name', {
        status: 'IN_REVIEW',
      }),
      articleRow('published-invalid', 'engineering/published-guide', {
        status: 'PUBLISHED',
      }),
      articleRow('archived-invalid', 'articles/golang/old-guide/', {
        status: 'ARCHIVED',
        archivedAt,
      }),
    ]);

    expect(report.summary).toEqual({
      totalArticles: 11,
      canonical: 2,
      invalid: 9,
      activeInvalid: 7,
      publishedInvalid: 1,
      draftReviewInvalid: 6,
      archivedInvalid: 2,
      suggestionCollisions: 3,
      blockers: 11,
      warnings: 1,
    });
    expect(report.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          contentId: 'legacy-active-a',
          classification: 'invalid_route',
          reason: 'missing_articles_prefix',
          severity: 'BLOCKER',
          suggestion: {
            slug: 'articles/architecture/route-collision',
            authoritative: false,
          },
        }),
        expect.objectContaining({
          contentId: 'generated',
          reason: 'legacy_generated_slug',
          suggestion: null,
        }),
        expect.objectContaining({
          contentId: 'wrong-count',
          reason: 'wrong_segment_count',
        }),
        expect.objectContaining({
          contentId: 'bad-domain',
          reason: 'invalid_domain_segment',
        }),
        expect.objectContaining({
          contentId: 'bad-slug',
          reason: 'invalid_slug_segment',
        }),
        expect.objectContaining({
          contentId: 'archived-invalid',
          classification: 'invalid_route',
          archivedAt: archivedAt.toISOString(),
          severity: 'BLOCKER',
        }),
      ]),
    );
    expect(report.suggestionCollisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'multiple_suggested_routes',
          suggestedSlug: 'articles/architecture/route-collision',
          severity: 'BLOCKER',
          candidateContentIds: ['legacy-active-a', 'legacy-archived-b'],
        }),
        expect.objectContaining({
          kind: 'active_canonical_route_owner',
          suggestedSlug: 'articles/architecture/route-collision',
          severity: 'BLOCKER',
          ownerContentIds: ['canonical'],
        }),
        expect.objectContaining({
          kind: 'archived_canonical_route_owner',
          suggestedSlug: 'articles/architecture/restore-route',
          severity: 'WARNING',
          ownerContentIds: ['archived-canonical'],
        }),
      ]),
    );
  });

  it('reports a clean canonical inventory without blockers', () => {
    const report = buildArticleRoutePreflightReport([
      articleRow('one', 'articles/golang/context'),
      articleRow('two', 'articles/architecture/transactional-outbox', {
        status: 'PUBLISHED',
      }),
    ]);

    expect(report.summary).toMatchObject({
      totalArticles: 2,
      canonical: 2,
      invalid: 0,
      suggestionCollisions: 0,
      blockers: 0,
      warnings: 0,
    });
    expect(report.rows.every((row) => row.classification === 'canonical')).toBe(
      true,
    );
  });
});
