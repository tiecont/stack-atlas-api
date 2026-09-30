export const MAX_CONTENT_SLUG_LENGTH = 255;

export class ContentSlugValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContentSlugValidationError';
  }
}

const CONTENT_SLUG_PATTERN =
  /^[a-z0-9]+(?:[._-][a-z0-9]+)*(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)*$/;
const RESERVED_ROUTE_SEGMENTS = new Set([
  'api',
  'admin',
  'login',
  'register',
  'account',
  '_next',
]);

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
