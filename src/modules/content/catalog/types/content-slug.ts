export const MAX_CONTENT_SLUG_LENGTH = 255;

export class ContentSlugValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContentSlugValidationError';
  }
}

export class ContentArticleRouteValidationError extends Error {
  constructor() {
    super('The article route must match articles/<domain>/<slug>.');
    this.name = 'ContentArticleRouteValidationError';
  }
}

const CONTENT_SLUG_PATTERN =
  /^[a-z0-9]+(?:[._-][a-z0-9]+)*(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)*$/;
const ARTICLE_ROUTE_SEGMENT_SOURCE = '[a-z0-9]+(?:-[a-z0-9]+)*';
const ARTICLE_ROUTE_SEGMENT_PATTERN = new RegExp(
  '^' + ARTICLE_ROUTE_SEGMENT_SOURCE + '$',
);
export const CANONICAL_ARTICLE_SLUG_PATTERN =
  '^articles/' +
  ARTICLE_ROUTE_SEGMENT_SOURCE +
  '/' +
  ARTICLE_ROUTE_SEGMENT_SOURCE +
  '$';
const CANONICAL_ARTICLE_SLUG_REGEX = new RegExp(CANONICAL_ARTICLE_SLUG_PATTERN);
const LEGACY_GENERATED_ARTICLE_SLUG_PATTERN = /^legacy-[a-f0-9]{32}$/;
const RESERVED_ROUTE_SEGMENTS = new Set([
  'api',
  'admin',
  'login',
  'register',
  'account',
  '_next',
]);

export type ContentArticleRouteReason =
  | 'canonical'
  | 'missing_articles_prefix'
  | 'wrong_segment_count'
  | 'invalid_domain_segment'
  | 'invalid_slug_segment'
  | 'reserved_or_malformed_path'
  | 'legacy_generated_slug'
  | 'route_exceeds_maximum_length';

export interface ContentArticleRouteClassification {
  classification: 'canonical' | 'invalid_route';
  reason: ContentArticleRouteReason;
  suggestedSlug: string | null;
}

export function normalizeContentSlug(value: unknown): string {
  if (typeof value !== 'string' || value.length > 1024) {
    throw new ContentSlugValidationError('slug must be a bounded string.');
  }

  const slug = value
    .trim()
    .toLowerCase()
    .replace(/\s*\/\s*/g, '/')
    .replace(/\s+/g, '-');
  if (slug.length === 0 || slug.length > MAX_CONTENT_SLUG_LENGTH) {
    throw new ContentSlugValidationError(
      `slug must contain 1 to ${MAX_CONTENT_SLUG_LENGTH} characters.`,
    );
  }
  if (slug.includes('..') || !CONTENT_SLUG_PATTERN.test(slug)) {
    throw new ContentSlugValidationError(
      'slug must use lowercase URL-safe segments without empty segments or consecutive dots.',
    );
  }
  if (RESERVED_ROUTE_SEGMENTS.has(slug.split('/', 1)[0]!)) {
    throw new ContentSlugValidationError(
      'slug starts with a reserved route segment.',
    );
  }

  return slug;
}

export function isCanonicalArticleSlug(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= MAX_CONTENT_SLUG_LENGTH &&
    value.trim() === value &&
    CANONICAL_ARTICLE_SLUG_REGEX.test(value)
  );
}

export function assertCanonicalArticleSlug(value: unknown): string {
  if (!isCanonicalArticleSlug(value)) {
    throw new ContentArticleRouteValidationError();
  }
  return value;
}

export function normalizeArticleSlug(value: unknown): string {
  if (typeof value !== 'string' || value.length > 1024) {
    throw new ContentArticleRouteValidationError();
  }
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/\s*\/\s*/g, '/')
    .replace(/\s+/g, '-');
  return assertCanonicalArticleSlug(slug);
}

export function classifyArticleRouteSlug(
  value: unknown,
): ContentArticleRouteClassification {
  if (isCanonicalArticleSlug(value)) {
    return {
      classification: 'canonical',
      reason: 'canonical',
      suggestedSlug: null,
    };
  }
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.startsWith('/') ||
    value.endsWith('/') ||
    value.includes('\\') ||
    value.includes('?') ||
    value.includes('#') ||
    value.includes('..') ||
    value.includes('//')
  ) {
    return invalidRoute('reserved_or_malformed_path');
  }
  if (value.length > MAX_CONTENT_SLUG_LENGTH) {
    return invalidRoute('route_exceeds_maximum_length');
  }
  if (LEGACY_GENERATED_ARTICLE_SLUG_PATTERN.test(value)) {
    return invalidRoute('legacy_generated_slug');
  }

  const segments = value.split('/');
  if (segments.length !== 3) {
    if (
      segments.length === 2 &&
      segments[0] !== 'articles' &&
      segments.every((segment) => ARTICLE_ROUTE_SEGMENT_PATTERN.test(segment))
    ) {
      const suggestedSlug = 'articles/' + value;
      return isCanonicalArticleSlug(suggestedSlug)
        ? invalidRoute('missing_articles_prefix', suggestedSlug)
        : invalidRoute('route_exceeds_maximum_length');
    }
    return invalidRoute('wrong_segment_count');
  }
  if (segments[0] !== 'articles') {
    return invalidRoute('missing_articles_prefix');
  }
  if (!ARTICLE_ROUTE_SEGMENT_PATTERN.test(segments[1] ?? '')) {
    return invalidRoute('invalid_domain_segment');
  }
  if (!ARTICLE_ROUTE_SEGMENT_PATTERN.test(segments[2] ?? '')) {
    return invalidRoute('invalid_slug_segment');
  }
  return invalidRoute('reserved_or_malformed_path');
}

function invalidRoute(
  reason: Exclude<ContentArticleRouteReason, 'canonical'>,
  suggestedSlug: string | null = null,
): ContentArticleRouteClassification {
  return { classification: 'invalid_route', reason, suggestedSlug };
}
