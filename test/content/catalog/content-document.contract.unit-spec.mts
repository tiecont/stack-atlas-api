import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ContentDocumentValidationError,
  validateContentDocument,
} from '../../../src/modules/content/catalog/types/content-document.js';

const fixture = JSON.parse(
  readFileSync(
    new URL('../../fixtures/content/content-document-v1.json', import.meta.url),
    'utf8',
  ),
) as unknown;

type MutableBlock = {
  id: string;
  type: string;
  version: number;
  props: Record<string, unknown>;
};

type MutableDocument = {
  schema_version: number;
  title: string;
  description: string;
  blocks: MutableBlock[];
};

function cloneFixture(): MutableDocument {
  return structuredClone(fixture) as MutableDocument;
}

function setRichTextChildren(
  document: MutableDocument,
  children: unknown[],
): void {
  const nodes = document.blocks[0]!.props['nodes'] as Record<string, unknown>[];
  nodes[0] = { type: 'paragraph', children };
}

describe('Content Document V1 contract', () => {
  it('accepts the canonical JSON fixture with all eight versioned block types', () => {
    const validated = validateContentDocument(fixture);

    expect(validated).toEqual(fixture);
    expect(validated.blocks.map((block) => block.type)).toEqual([
      'rich_text',
      'heading',
      'code',
      'callout',
      'image',
      'table',
      'divider',
      'related_content',
    ]);
    expect(validated.blocks[1]).toMatchObject({
      id: 'heading-overview',
      type: 'heading',
      props: { anchor: 'overview' },
    });
  });

  it('keeps paragraphs, lists, and inline formatting inside rich_text.props.nodes', () => {
    const legacyDocument = {
      schema_version: 1,
      title: 'Legacy block shape',
      description: 'The old paragraph block is not part of V1.',
      blocks: [{ type: 'paragraph', text: 'Outside rich_text.' }],
    };
    const nested = cloneFixture();
    nested.blocks[0]!.props['nodes'] = [
      {
        type: 'paragraph',
        children: [{ type: 'text', text: 'Valid nested paragraph.' }],
      },
      {
        type: 'bullet_list',
        items: [[{ type: 'text', text: 'Valid nested list.' }]],
      },
    ];

    expect(() => validateContentDocument(legacyDocument)).toThrow(
      ContentDocumentValidationError,
    );
    expect(validateContentDocument(nested).blocks[0]?.type).toBe('rich_text');
  });

  it('rejects unknown blocks, unsupported versions, and unknown props', () => {
    const unknownBlock = cloneFixture();
    unknownBlock.blocks[0]!.type = 'future_block';
    expect(() => validateContentDocument(unknownBlock)).toThrow(
      'document.blocks[0].type is not supported.',
    );

    const invalidVersion = cloneFixture();
    invalidVersion.blocks[0]!.version = 2;
    expect(() => validateContentDocument(invalidVersion)).toThrow(
      'document.blocks[0].version must be 1.',
    );

    const extraProp = cloneFixture();
    extraProp.blocks[0]!.props['paragraphs'] = ['unsupported'];
    expect(() => validateContentDocument(extraProp)).toThrow(
      'document.blocks[0].props.paragraphs is not supported.',
    );

    const extraDocumentField = cloneFixture();
    (extraDocumentField as MutableDocument & { published: boolean }).published =
      true;
    expect(() => validateContentDocument(extraDocumentField)).toThrow(
      'document.published is not supported.',
    );

    const extraEnvelopeField = cloneFixture();
    (
      extraEnvelopeField.blocks[0] as MutableBlock & { created_by: string }
    ).created_by = 'editor';
    expect(() => validateContentDocument(extraEnvelopeField)).toThrow(
      'document.blocks[0].created_by is not supported.',
    );

    const extraRichTextNodeField = cloneFixture();
    const richTextNodes = extraRichTextNodeField.blocks[0]!.props[
      'nodes'
    ] as Record<string, unknown>[];
    richTextNodes[0]!['unexpected'] = true;
    expect(() => validateContentDocument(extraRichTextNodeField)).toThrow(
      'document.blocks[0].props.nodes[0].unexpected is not supported.',
    );

    const extraInlineNodeField = cloneFixture();
    const paragraphNodes = extraInlineNodeField.blocks[0]!.props[
      'nodes'
    ] as Record<string, unknown>[];
    const children = paragraphNodes[0]!['children'] as Record<
      string,
      unknown
    >[];
    children[0]!['unexpected'] = true;
    expect(() => validateContentDocument(extraInlineNodeField)).toThrow(
      'document.blocks[0].props.nodes[0].children[0].unexpected is not supported.',
    );
  });

  it('rejects duplicate ids and treats the heading anchor separately from block id', () => {
    const duplicateIds = cloneFixture();
    duplicateIds.blocks[1]!.id = duplicateIds.blocks[0]!.id;
    expect(() => validateContentDocument(duplicateIds)).toThrow(
      'document.blocks[1].id must be unique within the document.',
    );

    const oldHeadingField = cloneFixture();
    oldHeadingField.blocks[1]!.props['id'] = 'overview';
    expect(() => validateContentDocument(oldHeadingField)).toThrow(
      'document.blocks[1].props.id is not supported.',
    );
  });

  it('rejects unsafe URLs in rich text links, images, and related content', () => {
    const unsafeLink = cloneFixture();
    setRichTextChildren(unsafeLink, [
      {
        type: 'link',
        href: 'javascript:alert(1)',
        children: [{ type: 'text', text: 'unsafe' }],
      },
    ]);
    expect(() => validateContentDocument(unsafeLink)).toThrow(
      'document.blocks[0].props.nodes[0].children[0].href must be a local path, fragment, or HTTP(S) URL without credentials.',
    );

    const unsafeImage = cloneFixture();
    unsafeImage.blocks[4]!.props['src'] = 'data:text/html,unsafe';
    expect(() => validateContentDocument(unsafeImage)).toThrow(
      'document.blocks[4].props.src must be a local path or HTTPS URL without credentials.',
    );

    const unsafeRelated = cloneFixture();
    const items = unsafeRelated.blocks[7]!.props['items'] as Record<
      string,
      unknown
    >[];
    items[0]!['href'] = 'javascript:alert(1)';
    expect(() => validateContentDocument(unsafeRelated)).toThrow(
      'document.blocks[7].props.items[0].href must be a local path, fragment, or HTTP(S) URL without credentials.',
    );

    const credentialLink = cloneFixture();
    setRichTextChildren(credentialLink, [
      {
        type: 'link',
        href: 'https://user:secret@example.com/',
        children: [{ type: 'text', text: 'unsafe' }],
      },
    ]);
    expect(() => validateContentDocument(credentialLink)).toThrow(
      'document.blocks[0].props.nodes[0].children[0].href must be a local path, fragment, or HTTP(S) URL without credentials.',
    );

    const protocolRelativeImage = cloneFixture();
    protocolRelativeImage.blocks[4]!.props['src'] = '//example.com/image.png';
    expect(() => validateContentDocument(protocolRelativeImage)).toThrow(
      'document.blocks[4].props.src must be a local path or HTTPS URL without credentials.',
    );

    const malformedAbsoluteLink = cloneFixture();
    setRichTextChildren(malformedAbsoluteLink, [
      {
        type: 'link',
        href: 'https:example.com/path',
        children: [{ type: 'text', text: 'malformed' }],
      },
    ]);
    expect(() => validateContentDocument(malformedAbsoluteLink)).toThrow(
      'document.blocks[0].props.nodes[0].children[0].href must be a local path, fragment, or HTTP(S) URL without credentials.',
    );

    const malformedAbsoluteImage = cloneFixture();
    malformedAbsoluteImage.blocks[4]!.props['src'] =
      'https:example.com/image.png';
    expect(() => validateContentDocument(malformedAbsoluteImage)).toThrow(
      'document.blocks[4].props.src must be a local path or HTTPS URL without credentials.',
    );

    const executableLink = cloneFixture();
    setRichTextChildren(executableLink, [
      {
        type: 'link',
        href: 'vbscript:msgbox(1)',
        children: [{ type: 'text', text: 'unsafe' }],
      },
    ]);
    expect(() => validateContentDocument(executableLink)).toThrow(
      'document.blocks[0].props.nodes[0].children[0].href must be a local path, fragment, or HTTP(S) URL without credentials.',
    );
  });

  it('enforces document, block-count, id, nesting, code-byte, and URL limits', () => {
    const oversizedDocument = cloneFixture();
    oversizedDocument.title = 'x'.repeat(1_048_576);
    expect(() => validateContentDocument(oversizedDocument)).toThrow(
      'document must not exceed 1048576 UTF-8 bytes.',
    );

    const tooManyBlocks = cloneFixture();
    tooManyBlocks.blocks = Array.from({ length: 501 }, (_, index) => ({
      ...structuredClone(tooManyBlocks.blocks[0]!),
      id: `body-${index}`,
    }));
    expect(() => validateContentDocument(tooManyBlocks)).toThrow(
      'document.blocks must be an array with at most 500 blocks.',
    );

    const oversizedId = cloneFixture();
    oversizedId.blocks[0]!.id = 'a'.repeat(129);
    expect(() => validateContentDocument(oversizedId)).toThrow(
      'document.blocks[0].id must contain 1 to 128 non-blank characters.',
    );

    const tooDeep = cloneFixture();
    let nested: Record<string, unknown> = { type: 'text', text: 'deep' };
    for (let depth = 0; depth < 17; depth += 1) {
      nested = { type: 'bold', children: [nested] };
    }
    setRichTextChildren(tooDeep, [nested]);
    expect(() => validateContentDocument(tooDeep)).toThrow('nested too deeply');

    const oversizedCode = cloneFixture();
    oversizedCode.blocks[2]!.props['code'] = '€'.repeat(33_334);
    expect(() => validateContentDocument(oversizedCode)).toThrow(
      'document.blocks[2].props.code must not exceed 100000 UTF-8 bytes.',
    );

    const oversizedUrl = cloneFixture();
    oversizedUrl.blocks[4]!.props['src'] = `/${'a'.repeat(2048)}`;
    expect(() => validateContentDocument(oversizedUrl)).toThrow(
      'document.blocks[4].props.src must contain 1 to 2048 non-blank characters.',
    );
  });

  it('bounds table rows, columns, row width, and cells plus related item count', () => {
    const tooManyColumns = cloneFixture();
    tooManyColumns.blocks[5]!.props['headers'] = Array.from(
      { length: 21 },
      (_, index) => `column-${index}`,
    );
    expect(() => validateContentDocument(tooManyColumns)).toThrow(
      'document.blocks[5].props.headers must contain 1 to 20 non-blank strings of at most 500 characters.',
    );

    const tooManyRows = cloneFixture();
    tooManyRows.blocks[5]!.props['rows'] = Array.from({ length: 101 }, () => [
      'Web',
      'Stack Atlas',
    ]);
    expect(() => validateContentDocument(tooManyRows)).toThrow(
      'document.blocks[5].props.rows must contain 1 to 100 rows matching the header count.',
    );

    const wrongWidth = cloneFixture();
    wrongWidth.blocks[5]!.props['rows'] = [['Web']];
    expect(() => validateContentDocument(wrongWidth)).toThrow(
      'document.blocks[5].props.rows must contain 1 to 100 rows matching the header count.',
    );

    const oversizedCell = cloneFixture();
    oversizedCell.blocks[5]!.props['rows'] = [['x'.repeat(2001), 'Owner']];
    expect(() => validateContentDocument(oversizedCell)).toThrow(
      'document.blocks[5].props.rows must contain 1 to 100 rows matching the header count.',
    );

    const tooManyRelatedItems = cloneFixture();
    tooManyRelatedItems.blocks[7]!.props['items'] = Array.from(
      { length: 21 },
      () => ({ title: 'Guide', href: '/guide/' }),
    );
    expect(() => validateContentDocument(tooManyRelatedItems)).toThrow(
      'document.blocks[7].props.items must contain 1 to 20 entries.',
    );
  });
});
