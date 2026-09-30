export type ContentBlockV1 =
  | { type: 'paragraph'; text: string }
  | { type: 'heading'; level: 2 | 3; id: string; text: string }
  | { type: 'code'; language: string; code: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'callout'; tone: 'info' | 'warning'; text: string; title?: string }
  | { type: 'quote'; text: string; attribution?: string };

export interface ContentDocumentV1 {
  schema_version: 1;
  title: string;
  description: string;
  blocks: ContentBlockV1[];
}

export class ContentDocumentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContentDocumentValidationError';
  }
}

const CONTENT_KEY_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,254}$/;
const HEADING_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function validateContentKey(contentKey: string): string {
  if (!CONTENT_KEY_PATTERN.test(contentKey)) {
    throw new ContentDocumentValidationError(
      'content_key must be 1 to 255 lowercase letters, digits, dots, underscores, colons, or hyphens and start with a letter or digit.',
    );
  }
  return contentKey;
}

export function validateContentDocument(value: unknown): ContentDocumentV1 {
  const document = record(value, 'document');
  exactKeys(
    document,
    ['schema_version', 'title', 'description', 'blocks'],
    'document',
  );
  if (document['schema_version'] !== 1) {
    throw new ContentDocumentValidationError(
      'document.schema_version must be 1.',
    );
  }
  const title = boundedText(document['title'], 'document.title', 160);
  const description = boundedText(
    document['description'],
    'document.description',
    500,
  );
  const sourceBlocks = document['blocks'];
  if (!Array.isArray(sourceBlocks) || sourceBlocks.length > 500) {
    throw new ContentDocumentValidationError(
      'document.blocks must be an array with at most 500 blocks.',
    );
  }

  const blocks = sourceBlocks.map((block, index) =>
    validateBlock(block, `document.blocks[${index}]`),
  );
  return { schema_version: 1, title, description, blocks };
}

function validateBlock(value: unknown, path: string): ContentBlockV1 {
  const block = record(value, path);
  const type = block['type'];
  switch (type) {
    case 'paragraph':
      exactKeys(block, ['type', 'text'], path);
      return { type, text: boundedText(block['text'], `${path}.text`, 10_000) };
    case 'heading': {
      exactKeys(block, ['type', 'level', 'id', 'text'], path);
      const level = block['level'];
      if (level !== 2 && level !== 3) {
        throw new ContentDocumentValidationError(
          `${path}.level must be 2 or 3.`,
        );
      }
      const id = boundedText(block['id'], `${path}.id`, 120);
      if (!HEADING_ID_PATTERN.test(id)) {
        throw new ContentDocumentValidationError(
          `${path}.id must be a lowercase hyphenated heading ID.`,
        );
      }
      return {
        type,
        level,
        id,
        text: boundedText(block['text'], `${path}.text`, 160),
      };
    }
    case 'code':
      exactKeys(block, ['type', 'language', 'code'], path);
      return {
        type,
        language: boundedText(block['language'], `${path}.language`, 40),
        code: boundedText(block['code'], `${path}.code`, 100_000, true),
      };
    case 'list': {
      exactKeys(block, ['type', 'ordered', 'items'], path);
      if (typeof block['ordered'] !== 'boolean') {
        throw new ContentDocumentValidationError(
          `${path}.ordered must be a boolean.`,
        );
      }
      const items = block['items'];
      if (!Array.isArray(items) || items.length === 0 || items.length > 100) {
        throw new ContentDocumentValidationError(
          `${path}.items must contain 1 to 100 entries.`,
        );
      }
      return {
        type,
        ordered: block['ordered'],
        items: items.map((item, index) =>
          boundedText(item, `${path}.items[${index}]`, 2_000),
        ),
      };
    }
    case 'callout': {
      exactKeys(block, ['type', 'tone', 'text', 'title'], path, ['title']);
      const tone = block['tone'];
      if (tone !== 'info' && tone !== 'warning') {
        throw new ContentDocumentValidationError(
          `${path}.tone must be info or warning.`,
        );
      }
      const title = block['title'];
      return {
        type,
        tone,
        text: boundedText(block['text'], `${path}.text`, 10_000),
        ...(title === undefined
          ? {}
          : { title: boundedText(title, `${path}.title`, 160) }),
      };
    }
    case 'quote': {
      exactKeys(block, ['type', 'text', 'attribution'], path, ['attribution']);
      const attribution = block['attribution'];
      return {
        type,
        text: boundedText(block['text'], `${path}.text`, 10_000),
        ...(attribution === undefined
          ? {}
          : {
              attribution: boundedText(attribution, `${path}.attribution`, 160),
            }),
      };
    }
    default:
      throw new ContentDocumentValidationError(
        `${path}.type is not supported.`,
      );
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  );
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!isPlainRecord(value)) {
    throw new ContentDocumentValidationError(`${path} must be an object.`);
  }
  return value;
}

function exactKeys(
  value: Record<string, unknown>,
  keys: string[],
  path: string,
  optional: string[] = [],
): void {
  const allowed = new Set(keys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new ContentDocumentValidationError(
        `${path}.${key} is not supported.`,
      );
    }
  }
  for (const key of keys) {
    if (!optional.includes(key) && !Object.hasOwn(value, key)) {
      throw new ContentDocumentValidationError(`${path}.${key} is required.`);
    }
  }
}

function boundedText(
  value: unknown,
  path: string,
  maximum: number,
  allowEmpty = false,
): string {
  if (
    typeof value !== 'string' ||
    value.length > maximum ||
    (!allowEmpty && value.trim().length === 0)
  ) {
    const detail = allowEmpty
      ? `at most ${maximum} characters`
      : `1 to ${maximum} non-blank characters`;
    throw new ContentDocumentValidationError(`${path} must contain ${detail}.`);
  }
  return value;
}
