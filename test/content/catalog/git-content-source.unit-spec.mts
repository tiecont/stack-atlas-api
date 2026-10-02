import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseGitContentSnapshot } from '../../../src/modules/content/catalog/helpers/git-content-source.js';

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('Git content source parser', () => {
  it('parses an exact clean Web snapshot and converts supported structures to V1', async () => {
    const root = createSourceCheckout();
    const snapshot = await parseGitContentSnapshot(root);
    const source = snapshot.articles.find(
      (article) => article.sourceId === 'source-article',
    );

    expect(snapshot.repository).toBe('tiecont/stack-atlas');
    expect(snapshot.commitSha).toMatch(/^[a-f0-9]{40}$/);
    expect(snapshot.inventory.map((file) => file.path)).toContain(
      'content/articles/architecture/source/article.html',
    );
    expect(source?.contentKey).toBe('article:source-article');
    expect(source?.slug).toBe('articles/architecture/source');
    expect(source?.errors).toEqual([]);
    expect(source?.relationships.learningPaths).toEqual([
      { pathId: 'engineering', moduleId: 'foundations' },
    ]);
    expect(snapshot.pathRecords[0]).toMatchObject({
      id: 'engineering',
      sourceMetadata: { title: 'Engineering' },
      modules: [
        {
          id: 'foundations',
          order: 1,
          articleIds: ['source-article'],
          sourceMetadata: { legacy_index_urls: ['/engineering/index.html'] },
        },
      ],
    });

    const blocks = source?.document?.blocks ?? [];
    expect(new Set(blocks.map((block) => block.type))).toEqual(
      new Set([
        'heading',
        'rich_text',
        'code',
        'callout',
        'table',
        'image',
        'divider',
        'related_content',
      ]),
    );
    expect(blocks.find((block) => block.type === 'heading')).toMatchObject({
      props: { level: 2, anchor: 'introduction', text: 'Introduction' },
    });
    expect(blocks.find((block) => block.type === 'image')).toMatchObject({
      props: { src: '/images/diagram.png', alt: 'Architecture diagram' },
    });
    expect(blocks.find((block) => block.type === 'code')).toMatchObject({
      props: { language: 'ts', code: 'const ready = true;' },
    });
    expect(blocks.find((block) => block.type === 'related_content')).toMatchObject({
      props: { items: [{ title: 'Target article', href: '/articles/architecture/target/' }] },
    });
    expect(source?.warnings.map((warning) => warning.code)).toContain(
      'svg_diagram_preserved_as_code',
    );
  });

  it('matches Web heading anchors without inheriting section ids', async () => {
    const root = createSourceCheckout(
      [
        '<section id="aggregate"><h2>Aggregate</h2><h3>Aggregate</h3></section>',
        '<div id="collision"></div><h2>Collision</h2>',
        '<h2 id="explicit-anchor">Explicit</h2>',
        '<h2>Ưu điểm</h2>',
        '<h4 id="subsection">Details</h4>',
      ].join(''),
    );
    const snapshot = await parseGitContentSnapshot(root);
    const source = snapshot.articles.find(
      (article) => article.sourceId === 'source-article',
    );
    const headings = source?.document?.blocks.filter(
      (block) => block.type === 'heading',
    );

    expect(headings?.map((block) => block.props)).toEqual([
      { level: 2, anchor: 'aggregate-2', text: 'Aggregate' },
      { level: 3, anchor: 'aggregate-3', text: 'Aggregate' },
      { level: 2, anchor: 'collision-2', text: 'Collision' },
      { level: 2, anchor: 'explicit-anchor', text: 'Explicit' },
      { level: 2, anchor: 'uu-điem', text: 'Ưu điểm' },
      { level: 4, anchor: 'subsection', text: 'Details' },
    ]);
  });

  it('reports an unsafe link and refuses to produce an importable document', async () => {
    const root = createSourceCheckout('<p><a href="javascript:alert(1)">unsafe</a></p>');
    const snapshot = await parseGitContentSnapshot(root);
    const source = snapshot.articles.find(
      (article) => article.sourceId === 'source-article',
    );

    expect(source?.document).toBeNull();
    expect(source?.errors.map((error) => error.code)).toContain('unsafe_link_url');
  });

  it('rejects unrecognized statuses and executable attributes inside containers', async () => {
    const root = createSourceCheckout(
      '<div class="callout"><span onclick="run()">Unsafe source</span></div>',
      'preview',
    );
    const snapshot = await parseGitContentSnapshot(root);
    const source = snapshot.articles.find(
      (article) => article.sourceId === 'source-article',
    );

    expect(source?.document).toBeNull();
    expect(source?.errors.map((error) => error.code)).toContain(
      'invalid_article_status',
    );
    expect(source?.errors.map((error) => error.code)).toContain(
      'event_handler_attribute',
    );
  });

  it('reports inline semantics that are flattened into plain text', async () => {
    const root = createSourceCheckout('<p>Scale<sup>2</sup></p>');
    const snapshot = await parseGitContentSnapshot(root);
    const source = snapshot.articles.find(
      (article) => article.sourceId === 'source-article',
    );

    expect(source?.document).not.toBeNull();
    expect(source?.warnings.map((warning) => warning.code)).toContain(
      'unsupported_inline_element_unwrapped',
    );
  });

  it('retains dangling article references for the relationship gap report', async () => {
    const root = createSourceCheckout(undefined, 'published', ['missing-article']);
    const snapshot = await parseGitContentSnapshot(root);

    expect(snapshot.sourceErrors).toEqual([]);
    expect(snapshot.pathRecords[0]?.modules[0]?.articleIds).toEqual([
      'missing-article',
    ]);
  });

  it('rejects a dirty working tree instead of importing a moving source', async () => {
    const root = createSourceCheckout();
    writeFileSync(path.join(root, 'content/articles/untracked.txt'), 'change');

    await expect(parseGitContentSnapshot(root)).rejects.toThrow(
      'working tree must be clean',
    );
  });
});

function createSourceCheckout(
  sourceHtml?: string,
  sourceStatus = 'published',
  pathArticleIds = ['source-article'],
): string {
  const root = mkdtempSync(path.join(tmpdir(), 'stack-atlas-source-'));
  temporaryRoots.push(root);
  writeArticle(
    root,
    'source',
    'source-article',
    sourceHtml ?? supportedHtml(),
    ['target-article'],
    sourceStatus,
  );
  writeArticle(root, 'target', 'target-article', '<p>Target text.</p>');
  mkdirSync(path.join(root, 'content/paths'), { recursive: true });
  mkdirSync(path.join(root, 'content/domains'), { recursive: true });
  writeFileSync(
    path.join(root, 'content/paths/engineering.yaml'),
    [
      'id: engineering',
      'title: Engineering',
      'modules:',
      '  - id: foundations',
      '    order: 1',
      '    article_ids:',
      ...pathArticleIds.map((articleId) => `      - ${articleId}`),
      '    legacy_index_urls:',
      '      - /engineering/index.html',
    ].join('\n'),
  );
  writeFileSync(path.join(root, 'content/categories.yaml'), 'categories: []\n');
  writeFileSync(path.join(root, 'content/domains/architecture.yaml'), 'id: architecture\n');
  execFileSync('git', ['-C', root, 'init', '-q', '-b', 'main']);
  execFileSync('git', [
    '-C',
    root,
    'remote',
    'add',
    'origin',
    'https://github.com/tiecont/stack-atlas.git',
  ]);
  execFileSync('git', ['-C', root, 'add', '.']);
  execFileSync('git', [
    '-C',
    root,
    '-c',
    'user.name=Stack Atlas Test',
    '-c',
    'user.email=stack-atlas-test@example.invalid',
    'commit',
    '-q',
    '-m',
    'source snapshot',
  ]);
  return root;
}

function writeArticle(
  root: string,
  folder: string,
  id: string,
  html: string,
  related: string[] = [],
  status = 'published',
): void {
  const directory = path.join(root, 'content/articles/architecture', folder);
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    path.join(directory, 'article.yaml'),
    [
      `id: ${id}`,
      `title: ${id === 'target-article' ? 'Target article' : 'Source article'}`,
      'description: Imported from a fixed Git snapshot.',
      'type: article',
      'domain: architecture',
      'category: architecture',
      'tags: [systems]',
      'learning_paths:',
      '  - path_id: engineering',
      '    module_id: foundations',
      'prerequisites: []',
      `related: ${JSON.stringify(related)}`,
      `status: ${status}`,
      `url: /articles/architecture/${folder}/`,
      'legacy_urls: [/old/article.html]',
    ].join('\n'),
  );
  writeFileSync(path.join(directory, 'article.html'), html);
}

function supportedHtml(): string {
  return [
    '<section id="intro"><h2>Introduction</h2>',
    '<p>Plain <strong>bold</strong>, <em>italic</em>, <code>inline</code>, and <a href="../target/">linked</a>.</p>',
    '<ul><li>First</li><li>Second</li></ul><ol><li>Ordered</li></ol>',
    '<div class="callout warn"><strong>Warning:</strong> Review this boundary.</div>',
    '<div class="code-label">TypeScript</div><pre><code class="language-ts">const ready = true;</code></pre>',
    '<table><thead><tr><th>Name</th><th>Value</th></tr></thead><tbody><tr><td>mode</td><td>safe</td></tr></tbody></table>',
    '<img src="/images/diagram.png" alt="Architecture diagram">',
    '<figure><svg xmlns="http://www.w3.org/2000/svg"><text>diagram</text></svg><figcaption>Inert SVG source</figcaption></figure>',
    '<hr></section>',
  ].join('');
}
