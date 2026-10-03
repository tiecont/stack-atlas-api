import { describe, expect, it } from 'vitest';
import {
  assertCanonicalArticleSlug,
  classifyArticleRouteSlug,
  ContentArticleRouteValidationError,
  ContentSlugValidationError,
  isCanonicalArticleSlug,
  MAX_CONTENT_SLUG_LENGTH,
  normalizeArticleSlug,
  normalizeContentSlug,
} from '../../../src/modules/content/catalog/types/content-slug.js';

describe('content slug policy', () => {
  it('normalizes case and whitespace and supports non-empty nested path segments', () => {
    expect(normalizeContentSlug('  Getting   Started / Install  ')).toBe(
      'getting-started/install',
    );
    expect(normalizeContentSlug('platform/content-model')).toBe(
      'platform/content-model',
    );
  });

  it('rejects reserved route roots, dot traversal, and empty path segments', () => {
    for (const slug of [
      'api',
      'admin/posts',
      'login',
      'register',
      'account/settings',
      '_next/static',
      'guide/../admin',
      '/leading-slash',
      'trailing-slash/',
      'double//slash',
    ]) {
      expect(() => normalizeContentSlug(slug), slug).toThrow(
        ContentSlugValidationError,
      );
    }
  });

  it('requires a bounded lowercase URL-safe path', () => {
    expect(() =>
      normalizeContentSlug('x'.repeat(MAX_CONTENT_SLUG_LENGTH + 1)),
    ).toThrow('slug must contain 1 to 255 characters.');
    expect(() => normalizeContentSlug('has?query')).toThrow(
      ContentSlugValidationError,
    );
  });

  it('accepts only canonical three-segment article routes', () => {
    for (const slug of [
      'articles/golang/context',
      'articles/architecture/transactional-outbox',
      'articles/distributed-systems/raft-mental-model',
    ]) {
      expect(isCanonicalArticleSlug(slug), slug).toBe(true);
      expect(assertCanonicalArticleSlug(slug)).toBe(slug);
      expect(classifyArticleRouteSlug(slug)).toMatchObject({
        classification: 'canonical',
        reason: 'canonical',
        suggestedSlug: null,
      });
    }
  });

  it('rejects malformed, non-article, and non-canonical route shapes', () => {
    for (const slug of [
      'engineering/new-guide',
      'article/golang/context',
      'articles/golang',
      'articles/golang/context/extra',
      '/articles/golang/context',
      'articles/golang/context/',
      'articles/golang//context',
      'articles/golang/../context',
      'articles/golang/context?x=1',
      'articles/golang/context#section',
      'articles/golang/context_name',
      'articles/golang/context.name',
      'articles/Golang/context',
      'articles/golang/context\n',
    ]) {
      expect(isCanonicalArticleSlug(slug), slug).toBe(false);
      expect(() => assertCanonicalArticleSlug(slug), slug).toThrow(
        ContentArticleRouteValidationError,
      );
      expect(classifyArticleRouteSlug(slug).classification, slug).toBe(
        'invalid_route',
      );
    }
  });

  it('normalizes case and whitespace without inventing route segments', () => {
    expect(
      normalizeArticleSlug('  ARTICLES / Architecture / New   Guide  '),
    ).toBe('articles/architecture/new-guide');
    expect(() => normalizeArticleSlug('engineering/new-guide')).toThrow(
      ContentArticleRouteValidationError,
    );
    expect(() => normalizeArticleSlug('articles/golang/context/extra')).toThrow(
      ContentArticleRouteValidationError,
    );
  });

  it('enforces the existing maximum slug length at the route boundary', () => {
    const atLimit =
      'articles/a/' + 'b'.repeat(MAX_CONTENT_SLUG_LENGTH - 11);
    expect(atLimit).toHaveLength(MAX_CONTENT_SLUG_LENGTH);
    expect(isCanonicalArticleSlug(atLimit)).toBe(true);
    expect(
      isCanonicalArticleSlug(
        'articles/a/' + 'b'.repeat(MAX_CONTENT_SLUG_LENGTH - 10),
      ),
    ).toBe(false);
    expect(() =>
      normalizeArticleSlug(
        'articles/a/' + 'b'.repeat(MAX_CONTENT_SLUG_LENGTH - 10),
      ),
    ).toThrow(ContentArticleRouteValidationError);
  });

  it('classifies safe two-segment legacy slugs with non-authoritative suggestions', () => {
    expect(classifyArticleRouteSlug('engineering/new-guide')).toEqual({
      classification: 'invalid_route',
      reason: 'missing_articles_prefix',
      suggestedSlug: 'articles/engineering/new-guide',
    });
    expect(
      classifyArticleRouteSlug('legacy-' + 'a'.repeat(32)),
    ).toMatchObject({
      classification: 'invalid_route',
      reason: 'legacy_generated_slug',
      suggestedSlug: null,
    });
    expect(classifyArticleRouteSlug('articles/golang')).toMatchObject({
      classification: 'invalid_route',
      reason: 'wrong_segment_count',
    });
    expect(classifyArticleRouteSlug('articles/Golang/context')).toMatchObject({
      classification: 'invalid_route',
      reason: 'invalid_domain_segment',
    });
    expect(
      classifyArticleRouteSlug('articles/golang/context_name'),
    ).toMatchObject({
      classification: 'invalid_route',
      reason: 'invalid_slug_segment',
    });
    expect(
      classifyArticleRouteSlug('articles/golang/../context'),
    ).toMatchObject({
      classification: 'invalid_route',
      reason: 'reserved_or_malformed_path',
    });
    expect(
      classifyArticleRouteSlug('a/' + 'b'.repeat(MAX_CONTENT_SLUG_LENGTH - 2)),
    ).toMatchObject({
      classification: 'invalid_route',
      reason: 'route_exceeds_maximum_length',
      suggestedSlug: null,
    });
  });
});
