export type InlineContentNodeV1 =
  | { type: 'text'; text: string }
  | { type: 'bold'; children: InlineContentNodeV1[] }
  | { type: 'italic'; children: InlineContentNodeV1[] }
  | { type: 'inline_code'; children: InlineContentNodeV1[] }
  | { type: 'link'; href: string; children: InlineContentNodeV1[] };

export type RichTextNodeV1 =
  | { type: 'paragraph'; children: InlineContentNodeV1[] }
  | { type: 'bullet_list'; items: InlineContentNodeV1[][] }
  | { type: 'ordered_list'; items: InlineContentNodeV1[][] };

export type ContentBlockV1 =
  | ContentBlockEnvelopeV1<'rich_text', { nodes: RichTextNodeV1[] }>
  | ContentBlockEnvelopeV1<
      'heading',
      { level: 2 | 3 | 4; anchor?: string; text: string }
    >
  | ContentBlockEnvelopeV1<'code', { language: string; code: string }>
  | ContentBlockEnvelopeV1<
      'callout',
      { tone: 'info' | 'warning'; text: string; title?: string }
    >
  | ContentBlockEnvelopeV1<
      'image',
      { src: string; alt: string; caption?: string }
    >
  | ContentBlockEnvelopeV1<
      'table',
      { headers: string[]; rows: string[][]; caption?: string }
    >
  | ContentBlockEnvelopeV1<'divider', Record<string, never>>
  | ContentBlockEnvelopeV1<
      'related_content',
      { items: { title: string; href: string; description?: string }[] }
    >;

type ContentBlockEnvelopeV1<TType extends string, TProps> = {
  id: string;
  type: TType;
  version: 1;
  props: TProps;
};

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
const BLOCK_ID_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,127}$/;
const HEADING_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const CONTENT_DOCUMENT_LIMITS_V1 = Object.freeze({
  maxDocumentBytes: 1_048_576,
  maxBlocks: 500,
  maxBlockIdLength: 128,
  maxRichTextDepth: 16,
  maxCodeBytes: 100_000,
  maxTableColumns: 20,
  maxTableRows: 100,
  maxRelatedItems: 20,
  maxUrlLength: 2048,
});

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
  assertDocumentSize(document);
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
  if (
    !Array.isArray(sourceBlocks) ||
    sourceBlocks.length > CONTENT_DOCUMENT_LIMITS_V1.maxBlocks
  ) {
    throw new ContentDocumentValidationError(
      'document.blocks must be an array with at most 500 blocks.',
    );
  }

  const blocks = sourceBlocks.map((block, index) =>
    validateBlock(block, `document.blocks[${index}]`),
  );
  const blockIds = new Set<string>();
  for (const [index, block] of blocks.entries()) {
    if (blockIds.has(block.id)) {
      throw new ContentDocumentValidationError(
        `document.blocks[${index}].id must be unique within the document.`,
      );
    }
    blockIds.add(block.id);
  }
  return { schema_version: 1, title, description, blocks };
}

function validateBlock(value: unknown, path: string): ContentBlockV1 {
  const block = record(value, path);
  exactKeys(block, ['id', 'type', 'version', 'props'], path);
  const id = boundedText(
    block['id'],
    `${path}.id`,
    CONTENT_DOCUMENT_LIMITS_V1.maxBlockIdLength,
  );
  if (!BLOCK_ID_PATTERN.test(id)) {
    throw new ContentDocumentValidationError(
      `${path}.id must start with a lowercase letter or digit and contain only lowercase letters, digits, dots, underscores, colons, or hyphens.`,
    );
  }
  if (block['version'] !== 1) {
    throw new ContentDocumentValidationError(`${path}.version must be 1.`);
  }
  const props = record(block['props'], `${path}.props`);

  switch (block['type']) {
    case 'rich_text':
      exactKeys(props, ['nodes'], `${path}.props`);
      return {
        id,
        type: 'rich_text',
        version: 1,
        props: {
          nodes: validateRichTextNodes(props['nodes'], `${path}.props.nodes`),
        },
      };
    case 'heading': {
      exactKeys(props, ['level', 'text', 'anchor'], `${path}.props`, [
        'anchor',
      ]);
      const level = props['level'];
      if (level !== 2 && level !== 3 && level !== 4) {
        throw new ContentDocumentValidationError(
          `${path}.props.level must be 2, 3, or 4.`,
        );
      }
      const anchor = props['anchor'];
      if (
        anchor !== undefined &&
        (typeof anchor !== 'string' ||
          anchor.length > 120 ||
          !HEADING_ID_PATTERN.test(anchor))
      ) {
        throw new ContentDocumentValidationError(
          `${path}.props.anchor must be a lowercase hyphenated heading anchor.`,
        );
      }
      return {
        id,
        type: 'heading',
        version: 1,
        props: {
          level,
          text: boundedText(props['text'], `${path}.props.text`, 160),
          ...(anchor === undefined ? {} : { anchor }),
        },
      };
    }
    case 'code':
      exactKeys(props, ['language', 'code'], `${path}.props`);
      return {
        id,
        type: 'code',
        version: 1,
        props: {
          language: boundedText(
            props['language'],
            `${path}.props.language`,
            40,
          ),
          code: boundedUtf8Text(
            props['code'],
            `${path}.props.code`,
            CONTENT_DOCUMENT_LIMITS_V1.maxCodeBytes,
            true,
          ),
        },
      };
    case 'callout': {
      exactKeys(props, ['tone', 'text', 'title'], `${path}.props`, ['title']);
      const tone = props['tone'];
      if (tone !== 'info' && tone !== 'warning') {
        throw new ContentDocumentValidationError(
          `${path}.props.tone must be info or warning.`,
        );
      }
      const title = props['title'];
      return {
        id,
        type: 'callout',
        version: 1,
        props: {
          tone,
          text: boundedText(props['text'], `${path}.props.text`, 10_000),
          ...(title === undefined
            ? {}
            : { title: boundedText(title, `${path}.props.title`, 160) }),
        },
      };
    }
    case 'image': {
      exactKeys(props, ['src', 'alt', 'caption'], `${path}.props`, ['caption']);
      const caption = props['caption'];
      return {
        id,
        type: 'image',
        version: 1,
        props: {
          src: safeImageSource(props['src'], `${path}.props.src`),
          alt: boundedText(props['alt'], `${path}.props.alt`, 1000, true),
          ...(caption === undefined
            ? {}
            : { caption: boundedText(caption, `${path}.props.caption`, 500) }),
        },
      };
    }
    case 'table': {
      exactKeys(props, ['headers', 'rows', 'caption'], `${path}.props`, [
        'caption',
      ]);
      const headers = stringArray(
        props['headers'],
        `${path}.props.headers`,
        CONTENT_DOCUMENT_LIMITS_V1.maxTableColumns,
        500,
      );
      const rows = props['rows'];
      if (
        !Array.isArray(rows) ||
        rows.length === 0 ||
        rows.length > CONTENT_DOCUMENT_LIMITS_V1.maxTableRows ||
        !rows.every(
          (row) =>
            Array.isArray(row) &&
            row.length === headers.length &&
            row.every((cell) => isBoundedText(cell, 2000, true)),
        )
      ) {
        throw new ContentDocumentValidationError(
          `${path}.props.rows must contain 1 to 100 rows matching the header count.`,
        );
      }
      const caption = props['caption'];
      return {
        id,
        type: 'table',
        version: 1,
        props: {
          headers,
          rows: rows as string[][],
          ...(caption === undefined
            ? {}
            : { caption: boundedText(caption, `${path}.props.caption`, 500) }),
        },
      };
    }
    case 'divider':
      exactKeys(props, [], `${path}.props`);
      return { id, type: 'divider', version: 1, props: {} };
    case 'related_content': {
      exactKeys(props, ['items'], `${path}.props`);
      const items = props['items'];
      if (
        !Array.isArray(items) ||
        items.length === 0 ||
        items.length > CONTENT_DOCUMENT_LIMITS_V1.maxRelatedItems
      ) {
        throw new ContentDocumentValidationError(
          `${path}.props.items must contain 1 to 20 entries.`,
        );
      }
      return {
        id,
        type: 'related_content',
        version: 1,
        props: {
          items: items.map((item, index) => {
            const itemPath = `${path}.props.items[${index}]`;
            const entry = record(item, itemPath);
            exactKeys(entry, ['title', 'href', 'description'], itemPath, [
              'description',
            ]);
            const description = entry['description'];
            return {
              title: boundedText(entry['title'], `${itemPath}.title`, 160),
              href: safeHref(entry['href'], `${itemPath}.href`),
              ...(description === undefined
                ? {}
                : {
                    description: boundedText(
                      description,
                      `${itemPath}.description`,
                      500,
                    ),
                  }),
            };
          }),
        },
      };
    }
    default:
      throw new ContentDocumentValidationError(
        `${path}.type is not supported.`,
      );
  }
}

function validateRichTextNodes(value: unknown, path: string): RichTextNodeV1[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 500) {
    throw new ContentDocumentValidationError(
      `${path} must contain 1 to 500 nodes.`,
    );
  }
  return value.map((item, index) => {
    const nodePath = `${path}[${index}]`;
    const node = record(item, nodePath);
    if (node['type'] === 'paragraph') {
      exactKeys(node, ['type', 'children'], nodePath);
      return {
        type: 'paragraph',
        children: validateInlineNodes(
          node['children'],
          `${nodePath}.children`,
          0,
        ),
      };
    }
    if (node['type'] === 'bullet_list' || node['type'] === 'ordered_list') {
      exactKeys(node, ['type', 'items'], nodePath);
      const items = node['items'];
      if (!Array.isArray(items) || items.length === 0 || items.length > 100) {
        throw new ContentDocumentValidationError(
          `${nodePath}.items must contain 1 to 100 entries.`,
        );
      }
      return {
        type: node['type'],
        items: items.map((entry, itemIndex) =>
          validateInlineNodes(entry, `${nodePath}.items[${itemIndex}]`, 0),
        ),
      };
    }
    throw new ContentDocumentValidationError(
      `${nodePath}.type is not supported.`,
    );
  });
}

function validateInlineNodes(
  value: unknown,
  path: string,
  depth: number,
): InlineContentNodeV1[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 500) {
    throw new ContentDocumentValidationError(
      `${path} must contain 1 to 500 inline nodes.`,
    );
  }
  if (depth > CONTENT_DOCUMENT_LIMITS_V1.maxRichTextDepth) {
    throw new ContentDocumentValidationError(`${path} is nested too deeply.`);
  }
  return value.map((item, index) => {
    const itemPath = `${path}[${index}]`;
    const node = record(item, itemPath);
    if (node['type'] === 'text') {
      exactKeys(node, ['type', 'text'], itemPath);
      return {
        type: 'text',
        text: boundedText(node['text'], `${itemPath}.text`, 10_000, true),
      };
    }
    if (node['type'] === 'link') {
      exactKeys(node, ['type', 'href', 'children'], itemPath);
      return {
        type: 'link',
        href: safeHref(node['href'], `${itemPath}.href`),
        children: validateInlineNodes(
          node['children'],
          `${itemPath}.children`,
          depth + 1,
        ),
      };
    }
    if (
      node['type'] === 'bold' ||
      node['type'] === 'italic' ||
      node['type'] === 'inline_code'
    ) {
      exactKeys(node, ['type', 'children'], itemPath);
      return {
        type: node['type'],
        children: validateInlineNodes(
          node['children'],
          `${itemPath}.children`,
          depth + 1,
        ),
      };
    }
    throw new ContentDocumentValidationError(
      `${itemPath}.type is not supported.`,
    );
  });
}

function assertDocumentSize(value: Record<string, unknown>): void {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new ContentDocumentValidationError(
      'document must be JSON serializable.',
    );
  }
  if (serialized === undefined) {
    throw new ContentDocumentValidationError(
      'document must be JSON serializable.',
    );
  }
  if (
    Buffer.byteLength(serialized, 'utf8') >
    CONTENT_DOCUMENT_LIMITS_V1.maxDocumentBytes
  ) {
    throw new ContentDocumentValidationError(
      `document must not exceed ${CONTENT_DOCUMENT_LIMITS_V1.maxDocumentBytes} UTF-8 bytes.`,
    );
  }
}

function boundedUtf8Text(
  value: unknown,
  path: string,
  maximumBytes: number,
  allowEmpty = false,
): string {
  const text = boundedText(value, path, maximumBytes, allowEmpty);
  if (Buffer.byteLength(text, 'utf8') > maximumBytes) {
    throw new ContentDocumentValidationError(
      `${path} must not exceed ${maximumBytes} UTF-8 bytes.`,
    );
  }
  return text;
}

function safeHref(value: unknown, path: string): string {
  const href = boundedText(
    value,
    path,
    CONTENT_DOCUMENT_LIMITS_V1.maxUrlLength,
  );
  if (!isSafeHref(href)) {
    throw new ContentDocumentValidationError(
      `${path} must be a local path, fragment, or HTTP(S) URL without credentials.`,
    );
  }
  return href;
}

function safeImageSource(value: unknown, path: string): string {
  const src = boundedText(value, path, CONTENT_DOCUMENT_LIMITS_V1.maxUrlLength);
  if (!isSafeLocalPath(src)) {
    let parsed: URL;
    try {
      parsed = new URL(src);
    } catch {
      throw new ContentDocumentValidationError(
        `${path} must be a local path or HTTPS URL without credentials.`,
      );
    }
    if (
      parsed.protocol !== 'https:' ||
      parsed.username.length > 0 ||
      parsed.password.length > 0
    ) {
      throw new ContentDocumentValidationError(
        `${path} must be a local path or HTTPS URL without credentials.`,
      );
    }
  }
  return src;
}

function isSafeHref(href: string): boolean {
  if (isSafeLocalPath(href) || href.startsWith('#')) return true;
  try {
    const parsed = new URL(href);
    return (
      (parsed.protocol === 'https:' || parsed.protocol === 'http:') &&
      parsed.username.length === 0 &&
      parsed.password.length === 0
    );
  } catch {
    return false;
  }
}

function isSafeLocalPath(value: string): boolean {
  if (
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('\\')
  ) {
    return false;
  }
  try {
    return (
      new URL(value, 'https://stack-atlas.invalid').origin ===
      'https://stack-atlas.invalid'
    );
  } catch {
    return false;
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
  if (!isBoundedText(value, maximum, allowEmpty)) {
    const detail = allowEmpty
      ? `at most ${maximum} characters`
      : `1 to ${maximum} non-blank characters`;
    throw new ContentDocumentValidationError(`${path} must contain ${detail}.`);
  }
  return value;
}

function isBoundedText(
  value: unknown,
  maximum: number,
  allowEmpty = false,
): value is string {
  return (
    typeof value === 'string' &&
    value.length <= maximum &&
    (allowEmpty || value.trim().length > 0)
  );
}

function stringArray(
  value: unknown,
  path: string,
  maxItems: number,
  maxLength: number,
): string[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > maxItems ||
    !value.every((item) => isBoundedText(item, maxLength))
  ) {
    throw new ContentDocumentValidationError(
      `${path} must contain 1 to ${maxItems} non-blank strings of at most ${maxLength} characters.`,
    );
  }
  return value as string[];
}
