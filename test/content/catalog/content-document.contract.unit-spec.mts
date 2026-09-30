import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ContentDocumentValidationError,
  validateContentDocument,
} from '../../../src/modules/content/catalog/types/content-document.js';

const fixture = JSON.parse(
  readFileSync(
    new URL('../../fixtures/content-document.v1.json', import.meta.url),
    'utf8',
  ),
) as unknown;

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
  });

  it('keeps paragraphs, lists, and inline formatting inside rich_text.props.nodes', () => {
    const legacyDocument = {
      schema_version: 1,
      title: 'Legacy block shape',
      description: 'The old paragraph block is not part of V1.',
      blocks: [{ type: 'paragraph', text: 'Outside rich_text.' }],
    };
    const fixtureDocument = structuredClone(fixture) as {
      blocks: {
        id: string;
        type: string;
        version: number;
        props: Record<string, unknown>;
      }[];
    };
    fixtureDocument.blocks[0]!.props['nodes'] = [
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
    expect(validateContentDocument(fixtureDocument).blocks[0]?.type).toBe(
      'rich_text',
    );
  });

  it('rejects unsupported block versions and additional persisted fields', () => {
    const invalidVersion = structuredClone(fixture) as {
      blocks: { version: number }[];
    };
    invalidVersion.blocks[0]!.version = 2;
    expect(() => validateContentDocument(invalidVersion)).toThrow(
      'document.blocks[0].version must be 1.',
    );

    const extraField = structuredClone(fixture) as {
      blocks: { props: Record<string, unknown> }[];
    };
    extraField.blocks[0]!.props['nodes'] = [];
    extraField.blocks[0]!.props['paragraphs'] = ['unsupported'];
    expect(() => validateContentDocument(extraField)).toThrow(
      'document.blocks[0].props.paragraphs is not supported.',
    );
  });

  it('requires block ids to be unique within a document', () => {
    const duplicateIds = structuredClone(fixture) as {
      blocks: { id: string }[];
    };
    duplicateIds.blocks[1]!.id = duplicateIds.blocks[0]!.id;

    expect(() => validateContentDocument(duplicateIds)).toThrow(
      'document.blocks[1].id must be unique within the document.',
    );
  });
});
