import type { ContentListCursor } from '../types/content-catalog.types';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class ContentCursorValidationError extends Error {
  constructor() {
    super('The pagination cursor is invalid.');
    this.name = 'ContentCursorValidationError';
  }
}

export function decodeContentListCursor(
  value: string | undefined,
): ContentListCursor | undefined {
  if (value === undefined) return undefined;
  if (value.length > 512) throw new ContentCursorValidationError();

  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  } catch {
    throw new ContentCursorValidationError();
  }
  if (!isRecord(decoded)) throw new ContentCursorValidationError();
  const keys = Object.keys(decoded).sort();
  if (
    keys.length !== 2 ||
    keys[0] !== 'contentId' ||
    keys[1] !== 'createdAt' ||
    typeof decoded['createdAt'] !== 'string' ||
    Number.isNaN(Date.parse(decoded['createdAt'])) ||
    typeof decoded['contentId'] !== 'string' ||
    !UUID_PATTERN.test(decoded['contentId'])
  ) {
    throw new ContentCursorValidationError();
  }
  return {
    createdAt: decoded['createdAt'],
    contentId: decoded['contentId'],
  };
}

export function encodeContentListCursor(cursor: ContentListCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

export function decodeRevisionCursor(
  value: string | undefined,
): number | undefined {
  if (value === undefined) return undefined;
  if (!/^[1-9][0-9]{0,8}$/.test(value)) {
    throw new ContentCursorValidationError();
  }
  return Number(value);
}

export function encodeRevisionCursor(revisionNumber: number): string {
  return String(revisionNumber);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  );
}
