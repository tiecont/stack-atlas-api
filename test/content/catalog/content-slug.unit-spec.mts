import { describe, expect, it } from 'vitest';
import {
  ContentSlugValidationError,
  MAX_CONTENT_SLUG_LENGTH,
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
});
