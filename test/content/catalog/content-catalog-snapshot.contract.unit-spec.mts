import { describe, expect, it } from 'vitest';
import {
  ContentCatalogSnapshotValidationError,
  validateContentCatalogSnapshot,
} from '../../../src/modules/content/catalog/types/content-catalog-snapshot.js';

describe('Content Catalog Snapshot V1 contract', () => {
  it('accepts the strict public catalog shape and returns normalized V1 data', () => {
    const validated = validateContentCatalogSnapshot(validSnapshot());

    expect(validated).toMatchObject({
      schema_version: 1,
      site: { name: 'Stack Atlas', language: 'vi' },
      topics: [{ id: 'architecture' }],
      categories: [{ id: 'engineering' }],
      paths: [{ modules: [{ articleIds: ['alpha'] }] }],
      articles: [{ contentKey: 'article:alpha' }],
      redirects: [{
        source: '/season-01-fundamentals/alpha.html',
        destination: '/articles/architecture/alpha/',
      }],
    });
  });

  it('rejects unsupported schema versions and unknown fields at every owned level', () => {
    const unsupportedVersion = validSnapshot();
    unsupportedVersion['schema_version'] = 2;
    expect(() => validateContentCatalogSnapshot(unsupportedVersion)).toThrow(
      ContentCatalogSnapshotValidationError,
    );

    const unknownTopLevel = validSnapshot();
    unknownTopLevel['debug'] = true;
    expect(() => validateContentCatalogSnapshot(unknownTopLevel)).toThrow(
      '$.debug is not supported',
    );

    const unknownModuleField = validSnapshot();
    const paths = unknownModuleField['paths'];
    if (!Array.isArray(paths)) throw new Error('Expected path fixture.');
    const modules = (paths[0] as Record<string, unknown>)['modules'];
    if (!Array.isArray(modules)) throw new Error('Expected path module fixture.');
    (modules[0] as Record<string, unknown>)['component'] = 'unsafe';
    expect(() => validateContentCatalogSnapshot(unknownModuleField)).toThrow(
      'component is not supported',
    );
  });

  it('rejects duplicate identities and unsafe redirect forms', () => {
    const duplicateRedirect = validSnapshot();
    const redirects = duplicateRedirect['redirects'];
    if (!Array.isArray(redirects)) throw new Error('Expected redirects fixture.');
    redirects.push({
      source: '/season-01-fundamentals/alpha.html',
      destination: '/other/',
      kind: 'article',
    });
    expect(() => validateContentCatalogSnapshot(duplicateRedirect)).toThrow(
      '$.redirects sources must be unique',
    );

    const unsafeRedirect = validSnapshot();
    const unsafeRedirects = unsafeRedirect['redirects'];
    if (!Array.isArray(unsafeRedirects)) throw new Error('Expected redirects fixture.');
    (unsafeRedirects[0] as Record<string, unknown>)['destination'] = '//evil.test/';
    expect(() => validateContentCatalogSnapshot(unsafeRedirect)).toThrow(
      'must be a safe local route',
    );
  });

  it('rejects an oversized serialized catalog snapshot', () => {
    const oversized = validSnapshot();
    const articles = oversized['articles'];
    if (!Array.isArray(articles)) throw new Error('Expected article metadata.');
    const article = articles[0];
    if (typeof article !== 'object' || article === null || Array.isArray(article)) {
      throw new Error('Expected article metadata object.');
    }
    (article as Record<string, unknown>)['review'] = {
      notes: 'x'.repeat(2_097_153),
    };

    expect(() => validateContentCatalogSnapshot(oversized)).toThrow(
      'Catalog snapshot exceeds 2097152 UTF-8 bytes',
    );
  });
});

function validSnapshot(): Record<string, unknown> {
  return {
    schema_version: 1,
    site: {
      name: 'Stack Atlas',
      description: 'Engineering knowledge.',
      language: 'vi',
    },
    topics: [{
      id: 'architecture',
      title: 'Architecture',
      description: 'System boundaries.',
      status: 'published',
    }],
    categories: [{ id: 'engineering', title: 'Engineering' }],
    paths: [{
      id: 'backend',
      title: 'Backend',
      description: 'Backend learning path.',
      status: 'published',
      legacyIndexUrls: [],
      modules: [{
        id: 'foundations',
        title: 'Foundations',
        order: 1,
        domain: 'architecture',
        category: 'engineering',
        articleIds: ['alpha'],
        legacyIndexUrls: [],
      }],
    }],
    articles: [{
      sourceId: 'alpha',
      contentKey: 'article:alpha',
      domain: 'architecture',
      category: 'engineering',
      tags: [],
      difficulty: 'unspecified',
      learningPaths: [{ pathId: 'backend', moduleId: 'foundations' }],
      prerequisites: [],
      related: [],
      labs: [],
      authors: [],
      kubernetes: null,
      review: null,
      legacyUrls: ['/season-01-fundamentals/alpha.html'],
    }],
    redirects: [{
      source: '/season-01-fundamentals/alpha.html',
      destination: '/articles/architecture/alpha/',
      kind: 'article',
    }],
  };
}
