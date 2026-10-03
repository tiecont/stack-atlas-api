import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import type { DefaultTreeAdapterTypes } from 'parse5' with {
  'resolution-mode': 'import',
};
import { parse as parseYaml } from 'yaml';
import type {
  ContentBlockV1,
  InlineContentNodeV1,
  RichTextNodeV1,
} from '../types/content-document';
import {
  isValidHeadingAnchorV1,
  validateContentDocument,
  validateContentKey,
} from '../types/content-document';
import type {
  GitContentImportIssue,
  GitContentPathRecord,
  GitContentRelationships,
  GitContentSnapshot,
  GitContentSourceArticle,
} from '../types/git-content-import.types';
import type {
  ContentCatalogPathV1,
  ContentCatalogSnapshotV1 as CatalogSnapshot,
  ContentCatalogTopicV1,
} from '../types/content-catalog.types';
import { validateContentCatalogSnapshot } from '../types/content-catalog-snapshot';
import { assertCanonicalArticleSlug } from '../types/content-slug';

const SOURCE_REPOSITORY = 'tiecont/stack-atlas';
const LOCAL_ORIGIN = 'https://stack-atlas.invalid';
const MAX_SOURCE_FILE_BYTES = 1_048_576;
const BLOCKED_HTML_ELEMENTS = new Set([
  'embed',
  'form',
  'iframe',
  'input',
  'object',
  'script',
  'style',
  'video',
  'audio',
]);
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const ARTICLE_METADATA_KEYS = new Set([
  'authors',
  'category',
  'description',
  'difficulty',
  'domain',
  'id',
  'kubernetes',
  'labs',
  'learning_paths',
  'legacy_urls',
  'prerequisites',
  'related',
  'review',
  'schema_version',
  'status',
  'tags',
  'title',
  'type',
  'url',
]);

type HtmlNode = DefaultTreeAdapterTypes.Node;
type HtmlElement = DefaultTreeAdapterTypes.Element;
type HtmlText = DefaultTreeAdapterTypes.TextNode;

interface HtmlParser {
  parseFragment(
    html: string,
    options: { sourceCodeLocationInfo: true },
  ): DefaultTreeAdapterTypes.DocumentFragment;
  serializeOuter(node: HtmlNode): string;
}

interface RawArticle {
  yamlPath: string;
  htmlPath: string;
  yamlText: string | null;
  htmlText: string | null;
  metadata: Record<string, unknown> | null;
  article: GitContentSourceArticle;
}

interface ConversionContext {
  blocks: ContentBlockV1[];
  warnings: GitContentImportIssue[];
  errors: GitContentImportIssue[];
  sourceId: string;
  sourcePath: string;
  slug: string;
  headingAnchors: Map<HtmlElement, string>;
  parser: HtmlParser;
}

export async function parseGitContentSnapshot(
  sourceRoot: string,
): Promise<GitContentSnapshot> {
  const parser: HtmlParser = await import('parse5');
  const root = path.resolve(sourceRoot);
  const commitSha = assertSourceCheckout(root);
  const contentRoot = path.join(root, 'content');
  const articleRoot = path.join(contentRoot, 'articles');
  const sourceErrors: GitContentImportIssue[] = [];
  if (!statSync(articleRoot, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error('The source checkout has no content/articles directory.');
  }

  const inventoryPaths = [
    ...walkFiles(contentRoot).filter((file) => /\.ya?ml$/i.test(file)),
    ...walkFiles(articleRoot).filter((file) => /\.html$/i.test(file)),
  ];
  const inventory = [...new Set(inventoryPaths)].sort().map((absolutePath) => {
    const contents = readFileSync(absolutePath);
    const sourcePath = toSourcePath(root, absolutePath);
    if (contents.byteLength > MAX_SOURCE_FILE_BYTES) {
      sourceErrors.push(
        issue(
          'source_file_too_large',
          `Source file exceeds ${MAX_SOURCE_FILE_BYTES} UTF-8 bytes.`,
          sourcePath,
        ),
      );
    }
    return { path: sourcePath, sha256: sha256(contents) };
  });

  const yamlPaths = walkFiles(articleRoot)
    .filter((file) => /\/article\.ya?ml$/i.test(file))
    .sort();
  const htmlPaths = new Set(
    walkFiles(articleRoot)
      .filter((file) => /\/article\.html$/i.test(file))
      .map((file) => path.resolve(file)),
  );
  const discoveredHtml = new Set<string>();
  const rawArticles: RawArticle[] = yamlPaths.map((yamlPath) => {
    const htmlPath = path.join(path.dirname(yamlPath), 'article.html');
    if (htmlPaths.has(path.resolve(htmlPath)))
      discoveredHtml.add(path.resolve(htmlPath));
    const sourceYamlPath = toSourcePath(root, yamlPath);
    const sourceHtmlPath = toSourcePath(root, htmlPath);
    const errors: GitContentImportIssue[] = [];
    let yamlText: string | null = null;
    let htmlText: string | null = null;
    let metadata: Record<string, unknown> | null = null;

    try {
      yamlText = readBoundedFile(yamlPath);
      metadata = asRecord(parseYaml(yamlText));
      if (!metadata) throw new Error('Article YAML must contain an object.');
    } catch (error) {
      errors.push(
        issue('invalid_article_metadata', errorMessage(error), sourceYamlPath),
      );
    }

    try {
      htmlText = readBoundedFile(htmlPath);
    } catch (error) {
      errors.push(
        issue('missing_or_invalid_html', errorMessage(error), sourceHtmlPath),
      );
    }

    const article = sourceArticle(metadata, sourceYamlPath, sourceHtmlPath);
    article.errors.push(...errors);
    article.sourceFiles = [sourceYamlPath, sourceHtmlPath];
    article.sourceChecksumSha256 =
      yamlText === null || htmlText === null
        ? null
        : sha256(`${yamlText}\u0000${htmlText}`);
    return { yamlPath, htmlPath, yamlText, htmlText, metadata, article };
  });

  for (const htmlPath of htmlPaths) {
    if (!discoveredHtml.has(htmlPath)) {
      sourceErrors.push(
        issue(
          'html_without_metadata',
          'Article HTML has no adjacent article.yaml.',
          toSourcePath(root, htmlPath),
        ),
      );
    }
  }

  const articleById = new Map<string, GitContentSourceArticle>();
  for (const raw of rawArticles) {
    if (raw.article.sourceId) {
      if (articleById.has(raw.article.sourceId)) {
        raw.article.errors.push(
          issue(
            'duplicate_article_id',
            `Article id ${raw.article.sourceId} is used more than once.`,
            toSourcePath(root, raw.yamlPath),
          ),
        );
      } else {
        articleById.set(raw.article.sourceId, raw.article);
      }
    }
  }

  for (const raw of rawArticles) {
    const { article, htmlText, metadata } = raw;
    if (!htmlText || !article.sourceId || !article.slug || !metadata) continue;
    const converted = convertArticleHtml(
      htmlText,
      article.sourceId,
      article.slug,
      toSourcePath(root, raw.htmlPath),
      parser,
    );
    article.warnings.push(...converted.warnings);
    article.errors.push(...converted.errors);

    const relatedBlock = relatedContentBlock(
      article,
      articleById,
      toSourcePath(root, raw.yamlPath),
    );
    if (relatedBlock.issue) article.errors.push(relatedBlock.issue);
    if (relatedBlock.block) converted.blocks.push(relatedBlock.block);

    if (article.errors.length > 0) continue;
    try {
      article.document = validateContentDocument({
        schema_version: 1,
        title: article.title,
        description: article.description,
        blocks: converted.blocks,
      });
    } catch (error) {
      article.errors.push(
        issue(
          'invalid_content_document',
          errorMessage(error),
          toSourcePath(root, raw.htmlPath),
        ),
      );
    }
  }

  const pathRecords = readPathRecords(contentRoot, root, sourceErrors);
  const pathIds = new Set<string>();
  for (const pathRecord of pathRecords) {
    if (pathIds.has(pathRecord.id)) {
      sourceErrors.push(
        issue(
          'duplicate_path_id',
          `Learning path id ${pathRecord.id} is duplicated.`,
          pathRecord.sourcePath,
        ),
      );
    }
    pathIds.add(pathRecord.id);
  }
  const catalog = readCatalogSnapshot(
    contentRoot,
    root,
    rawArticles,
    pathRecords,
    sourceErrors,
  );
  return {
    repository: SOURCE_REPOSITORY,
    commitSha,
    sourceRoot: root,
    inventory,
    articles: rawArticles.map((entry) => entry.article),
    pathRecords,
    catalog,
    sourceErrors,
  };
}

function readCatalogSnapshot(
  contentRoot: string,
  sourceRoot: string,
  rawArticles: RawArticle[],
  pathRecords: GitContentSnapshot['pathRecords'],
  sourceErrors: GitContentImportIssue[],
): CatalogSnapshot {
  const sitePath = path.join(contentRoot, 'site.yaml');
  const categoriesPath = path.join(contentRoot, 'categories.yaml');
  let site: CatalogSnapshot['site'] = {
    name: '',
    description: '',
    language: '',
  };
  let topics: ContentCatalogTopicV1[] = [];
  let categories: CatalogSnapshot['categories'] = [];

  try {
    const record = asRecord(parseYaml(readBoundedFile(sitePath)));
    if (!record) throw new Error('Site metadata must contain an object.');
    assertAllowedKeys(record, [
      'name',
      'description',
      'language',
      'base_url',
      'base_path',
    ]);
    if (
      typeof record['name'] !== 'string' ||
      typeof record['description'] !== 'string' ||
      typeof record['language'] !== 'string'
    ) {
      throw new Error(
        'Site metadata requires name, description, and language strings.',
      );
    }
    site = {
      name: record['name'],
      description: record['description'],
      language: record['language'],
    };
  } catch (error) {
    sourceErrors.push(
      issue(
        'invalid_site_metadata',
        errorMessage(error),
        toSourcePath(sourceRoot, sitePath),
      ),
    );
  }

  const domainsRoot = path.join(contentRoot, 'domains');
  if (statSync(domainsRoot, { throwIfNoEntry: false })?.isDirectory()) {
    topics = walkFiles(domainsRoot)
      .filter((file) => /\.ya?ml$/i.test(file))
      .sort()
      .flatMap((file) => {
        const sourcePath = toSourcePath(sourceRoot, file);
        try {
          const record = asRecord(parseYaml(readBoundedFile(file)));
          if (!record)
            throw new Error('Topic metadata must contain an object.');
          assertAllowedKeys(record, [
            'id',
            'title',
            'description',
            'status',
            'icon',
          ]);
          const id = nonEmptyString(record['id']);
          const title = nonEmptyString(record['title']);
          const description = nonEmptyString(record['description']);
          if (!id || !title || !description) {
            throw new Error(
              'Topic metadata requires id, title, and description strings.',
            );
          }
          if (
            (record['status'] !== undefined &&
              typeof record['status'] !== 'string') ||
            (record['icon'] !== undefined && typeof record['icon'] !== 'string')
          ) {
            throw new Error(
              'Topic status and icon must be strings when provided.',
            );
          }
          return [
            {
              id,
              title,
              description,
              ...(typeof record['status'] === 'string'
                ? { status: record['status'] }
                : {}),
              ...(typeof record['icon'] === 'string'
                ? { icon: record['icon'] }
                : {}),
            },
          ];
        } catch (error) {
          sourceErrors.push(
            issue('invalid_topic_metadata', errorMessage(error), sourcePath),
          );
          return [];
        }
      });
  } else {
    sourceErrors.push(
      issue(
        'missing_topic_metadata',
        'The content/domains directory is missing.',
        toSourcePath(sourceRoot, domainsRoot),
      ),
    );
  }

  try {
    const value: unknown = parseYaml(readBoundedFile(categoriesPath));
    if (!Array.isArray(value))
      throw new Error('Category metadata must contain an array.');
    categories = value.map((entry, index) => {
      const record = asRecord(entry);
      if (!record)
        throw new Error(`Category at index ${index} must be an object.`);
      assertAllowedKeys(record, ['id', 'title']);
      const id = nonEmptyString(record['id']);
      const title = nonEmptyString(record['title']);
      if (!id || !title)
        throw new Error(
          `Category at index ${index} requires id and title strings.`,
        );
      return { id, title };
    });
  } catch (error) {
    sourceErrors.push(
      issue(
        'invalid_category_metadata',
        errorMessage(error),
        toSourcePath(sourceRoot, categoriesPath),
      ),
    );
  }

  const articles = rawArticles.flatMap(({ article }) => {
    const relationships = article.relationships;
    if (!article.sourceId || !article.contentKey || !relationships.domain)
      return [];
    return [
      {
        sourceId: article.sourceId,
        contentKey: article.contentKey,
        domain: relationships.domain,
        category: relationships.category,
        tags: relationships.tags,
        difficulty: relationships.difficulty ?? 'unspecified',
        learningPaths: relationships.learningPaths,
        prerequisites: relationships.prerequisites,
        related: relationships.related,
        labs: relationships.labs,
        authors: relationships.authors,
        kubernetes: relationships.kubernetes,
        review: relationships.review,
        legacyUrls: relationships.legacyUrls,
      },
    ];
  });
  const paths: ContentCatalogPathV1[] = pathRecords.map((pathRecord) => ({
    id: pathRecord.id,
    title: pathRecord.title,
    description: pathRecord.description,
    ...(pathRecord.status === undefined ? {} : { status: pathRecord.status }),
    ...(pathRecord.domain === undefined ? {} : { domain: pathRecord.domain }),
    ...(pathRecord.difficulty === undefined
      ? {}
      : { difficulty: pathRecord.difficulty }),
    legacyIndexUrls: pathRecord.legacyIndexUrls,
    modules: pathRecord.modules.map((module) => ({
      id: module.id,
      title: module.title,
      order: module.order,
      domain: module.domain,
      category: module.category,
      ...(module.group === undefined ? {} : { group: module.group }),
      articleIds: module.articleIds,
      legacyIndexUrls: module.legacyIndexUrls,
    })),
  }));
  const redirects = buildCatalogRedirects(
    rawArticles.map(({ article }) => article),
    paths,
    sourceRoot,
    sourceErrors,
  );
  const candidate = {
    schema_version: 1,
    site,
    topics,
    categories,
    paths,
    articles,
    redirects,
  };
  try {
    return validateContentCatalogSnapshot(candidate);
  } catch (error) {
    sourceErrors.push(
      issue(
        'invalid_public_catalog',
        errorMessage(error),
        toSourcePath(sourceRoot, contentRoot),
      ),
    );
    return candidate as CatalogSnapshot;
  }
}

function buildCatalogRedirects(
  articles: GitContentSourceArticle[],
  paths: ContentCatalogPathV1[],
  sourceRoot: string,
  sourceErrors: GitContentImportIssue[],
): CatalogSnapshot['redirects'] {
  const redirects: CatalogSnapshot['redirects'] = [];
  const add = (
    source: string,
    destination: string,
    kind: 'article' | 'path-module',
    sourcePath: string,
  ) => {
    const sourcePattern =
      kind === 'article'
        ? /^\/season-\d{2}-[a-z0-9-]+\/[a-z0-9-]+\.html$/
        : /^\/season-\d{2}-[a-z0-9-]+\/index\.html$/;
    if (
      !sourcePattern.test(source) ||
      source.includes('..') ||
      source.includes('\\')
    ) {
      sourceErrors.push(
        issue(
          'invalid_legacy_redirect',
          `Unsupported legacy route ${source}.`,
          sourcePath,
        ),
      );
      return;
    }
    redirects.push({ source, destination, kind });
  };
  for (const article of articles) {
    if (!article.slug) continue;
    for (const source of article.relationships.legacyUrls) {
      add(
        source,
        `/${article.slug}/`,
        'article',
        article.sourceFiles[0] ?? 'content/articles',
      );
    }
  }
  for (const learningPath of paths) {
    for (const source of learningPath.legacyIndexUrls) {
      add(
        source,
        `/paths/${learningPath.id}/`,
        'path-module',
        `content/paths/${learningPath.id}.yaml`,
      );
    }
    for (const module of learningPath.modules) {
      for (const source of module.legacyIndexUrls) {
        add(
          source,
          `/paths/${learningPath.id}/#module-${module.id}`,
          'path-module',
          `content/paths/${learningPath.id}.yaml`,
        );
      }
    }
  }
  const seen = new Set<string>();
  for (const redirect of redirects) {
    if (seen.has(redirect.source)) {
      sourceErrors.push(
        issue(
          'duplicate_legacy_redirect',
          `Legacy route ${redirect.source} is defined more than once.`,
          redirect.source,
        ),
      );
    }
    seen.add(redirect.source);
  }
  const sourceSet = new Set(redirects.map((redirect) => redirect.source));
  for (const redirect of redirects) {
    if (sourceSet.has(redirect.destination.split('#', 1)[0] ?? '')) {
      sourceErrors.push(
        issue(
          'legacy_redirect_chain',
          `Legacy redirect ${redirect.source} points to another legacy route.`,
          redirect.source,
        ),
      );
    }
  }
  return redirects;
}

function assertSourceCheckout(root: string): string {
  const runGit = (args: string[]): string =>
    execFileSync('git', ['-C', root, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  let origin: string;
  let commitSha: string;
  try {
    origin = runGit(['remote', 'get-url', 'origin']);
    commitSha = runGit(['rev-parse', 'HEAD']);
  } catch {
    throw new Error('The content source must be a Git checkout with origin.');
  }
  if (!isExpectedRemote(origin)) {
    throw new Error(`Expected origin for ${SOURCE_REPOSITORY}.`);
  }
  if (!/^[0-9a-f]{40}$/i.test(commitSha)) {
    throw new Error(
      'The source checkout did not resolve to an exact commit SHA.',
    );
  }
  if (runGit(['status', '--porcelain', '--untracked-files=all'])) {
    throw new Error(
      'The content source working tree must be clean; import only a recorded commit.',
    );
  }
  return commitSha.toLowerCase();
}

function isExpectedRemote(value: string): boolean {
  const remote = value
    .trim()
    .replace(/^git@github\.com:/i, 'https://github.com/')
    .replace(/^ssh:\/\//i, 'https://');
  try {
    const parsed = new URL(remote);
    return (
      parsed.hostname.toLowerCase() === 'github.com' &&
      !parsed.username &&
      !parsed.password &&
      parsed.pathname
        .replace(/\.git$/i, '')
        .replace(/\/$/, '')
        .toLowerCase() === `/${SOURCE_REPOSITORY}`
    );
  } catch {
    return false;
  }
}

function sourceArticle(
  metadata: Record<string, unknown> | null,
  yamlPath: string,
  htmlPath: string,
): GitContentSourceArticle {
  const sourceId = nonEmptyString(metadata?.['id']);
  const contentKey = sourceId ? `article:${sourceId}` : null;
  const sourceStatus =
    nonEmptyString(metadata?.['status'])?.toLowerCase() ?? null;
  const rawUrl = nonEmptyString(metadata?.['url']);
  const article: GitContentSourceArticle = {
    sourceId,
    contentKey,
    slug: null,
    title: nonEmptyString(metadata?.['title']),
    description: nonEmptyString(metadata?.['description']),
    sourceStatus,
    document: null,
    sourceFiles: [yamlPath, htmlPath],
    sourceChecksumSha256: null,
    relationships: readRelationships(metadata),
    warnings: [],
    errors: [],
  };

  if (!metadata) return article;
  for (const key of Object.keys(metadata)) {
    if (!ARTICLE_METADATA_KEYS.has(key)) {
      article.errors.push(
        issue(
          'unsupported_article_metadata',
          `Article metadata field ${key} has no importer mapping.`,
          yamlPath,
        ),
      );
    }
  }
  validateRelationshipMetadata(metadata, yamlPath, article.errors);
  if (!article.relationships.domain) {
    article.errors.push(
      issue(
        'missing_article_topic',
        'Article metadata requires a domain for public catalog membership.',
        yamlPath,
      ),
    );
  }
  if (
    metadata['schema_version'] !== undefined &&
    metadata['schema_version'] !== 1
  ) {
    article.errors.push(
      issue(
        'unsupported_article_schema',
        'Article metadata schema_version must be 1.',
        yamlPath,
      ),
    );
  }
  if (metadata['type'] !== undefined && metadata['type'] !== 'article') {
    article.errors.push(
      issue(
        'unsupported_content_kind',
        'Only article content is supported by this importer.',
        yamlPath,
      ),
    );
  }
  if (!sourceId) {
    article.errors.push(
      issue('missing_article_id', 'Article metadata has no id.', yamlPath),
    );
  } else {
    try {
      validateContentKey(`article:${sourceId}`);
    } catch (error) {
      article.errors.push(
        issue('invalid_article_id', errorMessage(error), yamlPath),
      );
    }
  }
  if (!article.title) {
    article.errors.push(
      issue(
        'missing_article_title',
        'Article metadata has no title.',
        yamlPath,
      ),
    );
  }
  if (!article.description) {
    article.errors.push(
      issue(
        'missing_article_description',
        'Article metadata has no description.',
        yamlPath,
      ),
    );
  }
  if (!sourceStatus) {
    article.errors.push(
      issue(
        'missing_article_status',
        'Article metadata has no status.',
        yamlPath,
      ),
    );
  } else if (sourceStatus !== 'published' && sourceStatus !== 'draft') {
    article.errors.push(
      issue(
        'invalid_article_status',
        `Article status ${sourceStatus} is not supported by the importer.`,
        yamlPath,
      ),
    );
  }
  if (!rawUrl) {
    article.errors.push(
      issue('missing_article_url', 'Article metadata has no url.', yamlPath),
    );
  } else {
    try {
      article.slug = assertCanonicalArticleSlug(rawUrl.replace(/^\/|\/$/g, ''));
    } catch (error) {
      article.errors.push(
        issue('invalid_article_url', errorMessage(error), yamlPath),
      );
    }
  }
  return article;
}

function readRelationships(
  metadata: Record<string, unknown> | null,
): GitContentRelationships {
  return {
    domain: nonEmptyString(metadata?.['domain']),
    category: nonEmptyString(metadata?.['category']),
    tags: stringArray(metadata?.['tags']),
    authors: stringArray(metadata?.['authors']),
    difficulty: nonEmptyString(metadata?.['difficulty']),
    labs: stringArray(metadata?.['labs']),
    kubernetes: asRecord(metadata?.['kubernetes']),
    review: asRecord(metadata?.['review']),
    learningPaths: readLearningPaths(metadata?.['learning_paths']),
    prerequisites: stringArray(metadata?.['prerequisites']),
    related: stringArray(metadata?.['related']),
    legacyUrls: stringArray(metadata?.['legacy_urls']),
  };
}

function validateRelationshipMetadata(
  metadata: Record<string, unknown>,
  sourcePath: string,
  errors: GitContentImportIssue[],
): void {
  for (const field of [
    'authors',
    'labs',
    'legacy_urls',
    'prerequisites',
    'related',
    'tags',
  ]) {
    const value = metadata[field];
    if (
      value !== undefined &&
      (!Array.isArray(value) ||
        !value.every((entry) => typeof entry === 'string'))
    ) {
      errors.push(
        issue(
          'invalid_article_relationship_metadata',
          `Article metadata ${field} must be an array of strings.`,
          sourcePath,
        ),
      );
    }
  }
  for (const field of ['category', 'difficulty', 'domain']) {
    const value = metadata[field];
    if (value !== undefined && typeof value !== 'string') {
      errors.push(
        issue(
          'invalid_article_relationship_metadata',
          `Article metadata ${field} must be a string.`,
          sourcePath,
        ),
      );
    }
  }
  if (metadata['learning_paths'] !== undefined) {
    const validMemberships =
      Array.isArray(metadata['learning_paths']) &&
      metadata['learning_paths'].every((entry) => {
        const membership = asRecord(entry);
        return (
          typeof membership?.['path_id'] === 'string' &&
          typeof membership['module_id'] === 'string' &&
          Object.keys(membership).every((key) =>
            ['path_id', 'module_id'].includes(key),
          )
        );
      });
    if (!validMemberships) {
      errors.push(
        issue(
          'invalid_article_relationship_metadata',
          'Article metadata learning_paths must contain path_id and module_id strings.',
          sourcePath,
        ),
      );
    }
  }
  for (const field of ['kubernetes', 'review']) {
    const value = metadata[field];
    if (value !== undefined && !asRecord(value)) {
      errors.push(
        issue(
          'invalid_article_relationship_metadata',
          `Article metadata ${field} must be an object.`,
          sourcePath,
        ),
      );
    }
  }
}

function readLearningPaths(
  value: unknown,
): { pathId: string; moduleId: string }[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const record = asRecord(entry);
    const pathId = nonEmptyString(record?.['path_id']);
    const moduleId = nonEmptyString(record?.['module_id']);
    return pathId && moduleId ? [{ pathId, moduleId }] : [];
  });
}

function readPathRecords(
  contentRoot: string,
  sourceRoot: string,
  sourceErrors: GitContentImportIssue[],
): GitContentPathRecord[] {
  const pathsRoot = path.join(contentRoot, 'paths');
  if (!statSync(pathsRoot, { throwIfNoEntry: false })?.isDirectory()) return [];
  return walkFiles(pathsRoot)
    .filter((file) => /\.ya?ml$/i.test(file))
    .sort()
    .flatMap((file) => {
      const sourcePath = toSourcePath(sourceRoot, file);
      try {
        const record = asRecord(parseYaml(readBoundedFile(file)));
        const id = nonEmptyString(record?.['id']);
        if (!record || !id) {
          sourceErrors.push(
            issue(
              'invalid_path_metadata',
              'Learning path metadata has no id.',
              sourcePath,
            ),
          );
          return [];
        }
        assertAllowedKeys(record, [
          'id',
          'title',
          'description',
          'status',
          'domain',
          'difficulty',
          'modules',
          'legacy_index_urls',
        ]);
        const title = nonEmptyString(record['title']);
        const description = nonEmptyString(record['description']);
        if (!title || !description) {
          throw new Error(
            'Learning path metadata requires title and description strings.',
          );
        }
        if (
          (record['status'] !== undefined &&
            typeof record['status'] !== 'string') ||
          (record['domain'] !== undefined &&
            typeof record['domain'] !== 'string')
        ) {
          throw new Error(
            'Learning path status and domain must be strings when provided.',
          );
        }
        let difficulty: { start: string; end: string } | undefined;
        if (record['difficulty'] !== undefined) {
          const difficultyRecord = asRecord(record['difficulty']);
          if (
            !difficultyRecord ||
            typeof difficultyRecord['start'] !== 'string' ||
            typeof difficultyRecord['end'] !== 'string'
          ) {
            throw new Error(
              'Learning path difficulty requires start and end strings.',
            );
          }
          assertAllowedKeys(difficultyRecord, ['start', 'end']);
          difficulty = {
            start: difficultyRecord['start'],
            end: difficultyRecord['end'],
          };
        }
        if (!Array.isArray(record['modules'])) {
          sourceErrors.push(
            issue(
              'invalid_path_modules',
              'Learning path metadata must contain a modules array.',
              sourcePath,
            ),
          );
          return [];
        }
        const rootLegacyUrls = record['legacy_index_urls'];
        if (
          rootLegacyUrls !== undefined &&
          (!Array.isArray(rootLegacyUrls) ||
            !rootLegacyUrls.every((value) => typeof value === 'string'))
        ) {
          sourceErrors.push(
            issue(
              'invalid_path_redirect_metadata',
              'Path legacy_index_urls must be an array of strings.',
              sourcePath,
            ),
          );
          return [];
        }

        const moduleIds = new Set<string>();
        const modules: GitContentPathRecord['modules'] = [];
        for (const [index, value] of record['modules'].entries()) {
          const module = asRecord(value);
          const moduleId = nonEmptyString(module?.['id']);
          const moduleTitle = nonEmptyString(module?.['title']);
          const moduleDomain = nonEmptyString(module?.['domain']);
          const moduleCategory = nonEmptyString(module?.['category']);
          const order = module?.['order'];
          const articleIds = module?.['article_ids'];
          const legacyUrls = module?.['legacy_index_urls'];
          if (
            !module ||
            !moduleId ||
            !moduleTitle ||
            !moduleDomain ||
            !moduleCategory ||
            typeof order !== 'number' ||
            !Number.isInteger(order) ||
            !Array.isArray(articleIds) ||
            !articleIds.every((articleId) => typeof articleId === 'string') ||
            (legacyUrls !== undefined &&
              (!Array.isArray(legacyUrls) ||
                !legacyUrls.every((url) => typeof url === 'string')))
          ) {
            sourceErrors.push(
              issue(
                'invalid_path_module',
                `Path module at index ${index} requires id, integer order, article_ids, and valid legacy_index_urls.`,
                sourcePath,
              ),
            );
            continue;
          }
          assertAllowedKeys(module, [
            'id',
            'title',
            'order',
            'domain',
            'category',
            'group',
            'article_ids',
            'legacy_index_urls',
          ]);
          if (
            module['group'] !== undefined &&
            typeof module['group'] !== 'string'
          ) {
            sourceErrors.push(
              issue(
                'invalid_path_module',
                `Path module at index ${index} group must be a string.`,
                sourcePath,
              ),
            );
            continue;
          }
          if (moduleIds.has(moduleId)) {
            sourceErrors.push(
              issue(
                'duplicate_path_module_id',
                `Path module id ${moduleId} is duplicated.`,
                sourcePath,
              ),
            );
            continue;
          }
          moduleIds.add(moduleId);
          modules.push({
            id: moduleId,
            title: moduleTitle,
            order,
            domain: moduleDomain,
            category: moduleCategory,
            ...(typeof module['group'] === 'string'
              ? { group: module['group'] }
              : {}),
            articleIds: articleIds as string[],
            legacyIndexUrls: (legacyUrls as string[] | undefined) ?? [],
            sourceMetadata: module,
          });
        }

        return [
          {
            id,
            title,
            description,
            ...(typeof record['status'] === 'string'
              ? { status: record['status'] }
              : {}),
            ...(typeof record['domain'] === 'string'
              ? { domain: record['domain'] }
              : {}),
            ...(difficulty ? { difficulty } : {}),
            sourcePath,
            sourceMetadata: Object.fromEntries(
              Object.entries(record).filter(([key]) => key !== 'modules'),
            ),
            modules,
            legacyIndexUrls: (rootLegacyUrls as string[] | undefined) ?? [],
          },
        ];
      } catch (error) {
        sourceErrors.push(
          issue('invalid_path_metadata', errorMessage(error), sourcePath),
        );
        return [];
      }
    });
}

function convertArticleHtml(
  html: string,
  sourceId: string,
  slug: string,
  sourcePath: string,
  parser: HtmlParser,
): {
  blocks: ContentBlockV1[];
  warnings: GitContentImportIssue[];
  errors: GitContentImportIssue[];
} {
  const fragment = parser.parseFragment(html, { sourceCodeLocationInfo: true });
  const context: ConversionContext = {
    blocks: [],
    warnings: [],
    errors: [],
    sourceId,
    sourcePath,
    slug,
    headingAnchors: deriveWebHeadingAnchors(fragment),
    parser,
  };
  auditHtmlTree(fragment, context);
  walkChildren(fragment.childNodes, 'root', context);
  return {
    blocks: context.blocks,
    warnings: context.warnings,
    errors: context.errors,
  };
}

function walkChildren(
  nodes: HtmlNode[],
  parentPath: string,
  context: ConversionContext,
): void {
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    if (!node) continue;
    const nodePath = `${parentPath}.${index}`;
    if (isText(node)) {
      if (node.value.trim()) {
        addParagraph([{ type: 'text', text: node.value }], nodePath, context);
      }
      continue;
    }
    if (!isElement(node)) continue;
    const tag = node.tagName.toLowerCase();
    if (hasClass(node, 'code-label')) {
      const next = nextMeaningfulNode(nodes, index + 1);
      if (
        next &&
        isElement(next.node) &&
        next.node.tagName.toLowerCase() === 'pre'
      ) {
        const language = textContent(node).trim();
        addCodeBlock(
          next.node,
          `${parentPath}.${next.index}`,
          language,
          context,
        );
        index = next.index;
      } else {
        addParagraph(
          inlineChildren(node, nodePath, context),
          nodePath,
          context,
        );
      }
      continue;
    }

    if (node.namespaceURI === SVG_NAMESPACE || tag === 'svg') {
      addSvgBlock(node, nodePath, context);
      continue;
    }
    if (BLOCKED_HTML_ELEMENTS.has(tag)) {
      continue;
    }

    if (tag === 'section') {
      walkChildren(node.childNodes, nodePath, context);
    } else if (tag === 'h2' || tag === 'h3' || tag === 'h4') {
      addHeading(
        node,
        Number(tag.slice(1)) as 2 | 3 | 4,
        context.headingAnchors.get(node),
        nodePath,
        context,
      );
    } else if (tag === 'h1' || /^h[5-6]$/.test(tag)) {
      context.errors.push(
        issue(
          'unsupported_heading_level',
          `<${tag}> has no equivalent in Content Document V1.`,
          context.sourcePath,
        ),
      );
    } else if (tag === 'p') {
      addParagraph(inlineChildren(node, nodePath, context), nodePath, context);
    } else if (tag === 'ul' || tag === 'ol') {
      addList(
        node,
        tag === 'ul' ? 'bullet_list' : 'ordered_list',
        nodePath,
        context,
      );
    } else if (tag === 'pre') {
      addCodeBlock(node, nodePath, '', context);
    } else if (tag === 'blockquote' || hasClass(node, 'callout')) {
      addCallout(node, nodePath, context);
    } else if (tag === 'table') {
      addTable(node, nodePath, context);
    } else if (tag === 'hr') {
      addBlock(
        {
          id: blockId(context.sourceId, nodePath),
          type: 'divider',
          version: 1,
          props: {},
        },
        context,
      );
    } else if (tag === 'img') {
      addImage(node, nodePath, context);
    } else if (tag === 'br') {
      addParagraph([{ type: 'text', text: '\n' }], nodePath, context);
    } else if (tag === 'figcaption') {
      addParagraph(inlineChildren(node, nodePath, context), nodePath, context);
    } else if (
      tag === 'div' ||
      tag === 'figure' ||
      tag === 'article' ||
      tag === 'main' ||
      tag === 'header' ||
      tag === 'footer' ||
      tag === 'thead' ||
      tag === 'tbody' ||
      tag === 'tr' ||
      tag === 'td' ||
      tag === 'th' ||
      tag === 'caption'
    ) {
      if (
        hasClass(node, 'diagram') &&
        !containsElement(node, 'svg') &&
        !containsElement(node, 'pre')
      ) {
        context.warnings.push(
          issue(
            'diagram_wrapper_unwrapped',
            'Diagram wrapper had no SVG or preformatted source; text was retained.',
            context.sourcePath,
          ),
        );
      }
      walkChildren(node.childNodes, nodePath, context);
    } else if (
      tag === 'a' ||
      tag === 'span' ||
      tag === 'strong' ||
      tag === 'b' ||
      tag === 'em' ||
      tag === 'i' ||
      tag === 'code' ||
      tag === 'small' ||
      tag === 'label'
    ) {
      addParagraph(inlineChildren(node, nodePath, context), nodePath, context);
    } else {
      context.warnings.push(
        issue(
          'unsupported_html_element_unwrapped',
          `<${tag}> was unwrapped; its visible text and supported child structures were retained.`,
          context.sourcePath,
        ),
      );
      walkChildren(node.childNodes, nodePath, context);
    }
  }
}

function deriveWebHeadingAnchors(
  fragment: DefaultTreeAdapterTypes.DocumentFragment,
): Map<HtmlElement, string> {
  const elements: HtmlElement[] = [];
  const visit = (node: HtmlNode): void => {
    if (isElement(node)) elements.push(node);
    if ('childNodes' in node) node.childNodes.forEach(visit);
  };
  fragment.childNodes.forEach(visit);

  const reserved = new Set(
    elements.flatMap((element) => {
      const id = getAttribute(element, 'id');
      return id ? [id] : [];
    }),
  );
  const counts = new Map<string, number>();
  const anchors = new Map<HtmlElement, string>();

  for (const element of elements) {
    const tag = element.tagName.toLowerCase();
    const existingId = getAttribute(element, 'id');
    if (tag === 'h4') {
      if (existingId) anchors.set(element, existingId);
      continue;
    }
    if (tag !== 'h2' && tag !== 'h3') continue;
    if (existingId) {
      anchors.set(element, existingId);
      continue;
    }

    const base =
      webHeadingSlug(collapseWhitespace(textContent(element))) || 'section';
    let suffix = counts.get(base) ?? 1;
    let candidate = base;
    while (reserved.has(candidate)) candidate = `${base}-${++suffix}`;
    counts.set(base, suffix);
    reserved.add(candidate);
    anchors.set(element, candidate);
  }

  return anchors;
}

function webHeadingSlug(value: string): string {
  return value
    .normalize('NFKD')
    .toLowerCase()
    .trim()
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
}

function auditElement(element: HtmlElement, context: ConversionContext): void {
  for (const attribute of element.attrs) {
    if (/^on/i.test(attribute.name)) {
      context.errors.push(
        issue(
          'event_handler_attribute',
          `Executable attribute ${attribute.name} is not importable.`,
          context.sourcePath,
        ),
      );
    }
    if (attribute.name.toLowerCase() === 'style') {
      context.warnings.push(
        issue(
          'inline_style_removed',
          'Inline CSS is not part of Content Document V1; text and structure were retained.',
          context.sourcePath,
        ),
      );
    }
  }
}

function auditHtmlTree(node: HtmlNode, context: ConversionContext): void {
  if (!isElement(node)) {
    if ('childNodes' in node) {
      for (const child of node.childNodes) auditHtmlTree(child, context);
    }
    return;
  }
  auditElement(node, context);
  if (BLOCKED_HTML_ELEMENTS.has(node.tagName.toLowerCase())) {
    context.errors.push(
      issue(
        'unsafe_html_construct',
        `<${node.tagName.toLowerCase()}> cannot be imported as authored content.`,
        context.sourcePath,
      ),
    );
  }
  for (const child of node.childNodes) auditHtmlTree(child, context);
}

function addHeading(
  element: HtmlElement,
  level: 2 | 3 | 4,
  sourceAnchor: string | undefined,
  nodePath: string,
  context: ConversionContext,
): void {
  const text = collapseWhitespace(textContent(element));
  if (!text) return;
  let acceptedAnchor: string | undefined;
  if (sourceAnchor) {
    if (isValidHeadingAnchorV1(sourceAnchor)) {
      acceptedAnchor = sourceAnchor;
    } else {
      context.warnings.push(
        issue(
          'invalid_heading_anchor',
          `Source anchor ${sourceAnchor} is not valid in Content Document V1 and was omitted.`,
          context.sourcePath,
        ),
      );
    }
  }
  addBlock(
    {
      id: blockId(context.sourceId, nodePath),
      type: 'heading',
      version: 1,
      props: {
        level,
        text,
        ...(acceptedAnchor ? { anchor: acceptedAnchor } : {}),
      },
    },
    context,
  );
}

function addParagraph(
  children: InlineContentNodeV1[],
  nodePath: string,
  context: ConversionContext,
): void {
  if (children.length === 0 || !children.some(hasVisibleInlineText)) return;
  const node: RichTextNodeV1 = { type: 'paragraph', children };
  addBlock(
    {
      id: blockId(context.sourceId, nodePath),
      type: 'rich_text',
      version: 1,
      props: { nodes: [node] },
    },
    context,
  );
}

function addList(
  element: HtmlElement,
  type: 'bullet_list' | 'ordered_list',
  nodePath: string,
  context: ConversionContext,
): void {
  const listItems = element.childNodes.filter(
    (node): node is HtmlElement =>
      isElement(node) && node.tagName.toLowerCase() === 'li',
  );
  const items: InlineContentNodeV1[][] = [];
  const nestedLists: { node: HtmlElement; path: string }[] = [];
  for (const [index, item] of listItems.entries()) {
    const inline: InlineContentNodeV1[] = [];
    for (const [childIndex, child] of item.childNodes.entries()) {
      if (
        isElement(child) &&
        ['ul', 'ol'].includes(child.tagName.toLowerCase())
      ) {
        nestedLists.push({
          node: child,
          path: `${nodePath}.${index}.${childIndex}`,
        });
        continue;
      }
      inline.push(
        ...inlineChildren(child, `${nodePath}.${index}.${childIndex}`, context),
      );
    }
    const normalized = compactInlineWhitespace(inline);
    if (normalized.some(hasVisibleInlineText)) items.push(normalized);
  }
  if (items.length > 0) {
    addBlock(
      {
        id: blockId(context.sourceId, nodePath),
        type: 'rich_text',
        version: 1,
        props: { nodes: [{ type, items }] },
      },
      context,
    );
  }
  if (nestedLists.length > 0) {
    context.warnings.push(
      issue(
        'nested_list_flattened',
        'Nested list levels were emitted as adjacent flat list blocks because V1 lists have no nested-list node.',
        context.sourcePath,
      ),
    );
    for (const nested of nestedLists) {
      addList(
        nested.node,
        nested.node.tagName.toLowerCase() === 'ol'
          ? 'ordered_list'
          : 'bullet_list',
        nested.path,
        context,
      );
    }
  }
}

function addCodeBlock(
  element: HtmlElement,
  nodePath: string,
  label: string,
  context: ConversionContext,
): void {
  const codeElement = findFirstElement(element, 'code');
  const languageFromClass = codeElement
    ? getAttribute(codeElement, 'class')?.match(
        /(?:^|\s)language-([\w+#.-]+)/i,
      )?.[1]
    : undefined;
  const languageText = languageFromClass ?? label;
  const language = normalizeCodeLanguage(languageText, context);
  const code = textContent(element).replace(/^\n/, '').replace(/\n$/, '');
  if (!code.trim()) return;
  addBlock(
    {
      id: blockId(context.sourceId, nodePath),
      type: 'code',
      version: 1,
      props: { language, code },
    },
    context,
  );
}

function addSvgBlock(
  element: HtmlElement,
  nodePath: string,
  context: ConversionContext,
): void {
  context.warnings.push(
    issue(
      'svg_diagram_preserved_as_code',
      'SVG source is preserved in an inert code block; Content V1 has no asset storage or SVG renderer.',
      context.sourcePath,
    ),
  );
  addBlock(
    {
      id: blockId(context.sourceId, nodePath),
      type: 'code',
      version: 1,
      props: { language: 'svg', code: context.parser.serializeOuter(element) },
    },
    context,
  );
}

function addCallout(
  element: HtmlElement,
  nodePath: string,
  context: ConversionContext,
): void {
  if (
    ['a', 'img', 'table', 'ul', 'ol', 'pre', 'h2', 'h3', 'h4'].some((tag) =>
      containsElement(element, tag),
    )
  ) {
    context.errors.push(
      issue(
        'unsupported_callout_structure',
        'Callout links and nested block structures cannot be represented by Content Document V1.',
        context.sourcePath,
      ),
    );
    return;
  }
  const text = collapseWhitespace(textContent(element));
  if (!text) return;
  const firstStrong = findFirstElement(element, 'strong');
  const possibleTitle = firstStrong
    ? collapseWhitespace(textContent(firstStrong))
    : '';
  const body =
    possibleTitle && text.startsWith(possibleTitle)
      ? text.slice(possibleTitle.length).trim()
      : text;
  const title = body && possibleTitle.length <= 160 ? possibleTitle : undefined;
  const calloutText = title ? body : text;
  addBlock(
    {
      id: blockId(context.sourceId, nodePath),
      type: 'callout',
      version: 1,
      props: {
        tone:
          hasClass(element, 'warn') || hasClass(element, 'warning')
            ? 'warning'
            : 'info',
        text: calloutText,
        ...(title ? { title } : {}),
      },
    },
    context,
  );
}

function addTable(
  element: HtmlElement,
  nodePath: string,
  context: ConversionContext,
): void {
  if (
    ['a', 'img', 'svg', 'ul', 'ol', 'pre'].some((tag) =>
      containsElement(element, tag),
    ) ||
    descendants(element, 'table').length > 1
  ) {
    context.errors.push(
      issue(
        'unsupported_table_cell_content',
        'Table links, media, and nested structures cannot be represented by Content Document V1.',
        context.sourcePath,
      ),
    );
    return;
  }
  const rows = descendants(element, 'tr');
  const headerRow = rows.find((row) => descendants(row, 'th').length > 0);
  if (!headerRow) {
    context.errors.push(
      issue(
        'table_missing_headers',
        'Table has no header row and cannot map to Content Document V1.',
        context.sourcePath,
      ),
    );
    return;
  }
  const headers = directCells(headerRow, 'th').map((cell) =>
    collapseWhitespace(textContent(cell)),
  );
  const dataRows = rows
    .filter((row) => row !== headerRow)
    .map((row) =>
      directCells(row, 'td').map((cell) =>
        collapseWhitespace(textContent(cell)),
      ),
    )
    .filter((row) => row.length > 0);
  if (headers.length === 0 || dataRows.length === 0) {
    context.errors.push(
      issue(
        'table_missing_data',
        'Table must contain headers and at least one data row.',
        context.sourcePath,
      ),
    );
    return;
  }
  const caption = descendants(element, 'caption')[0];
  addBlock(
    {
      id: blockId(context.sourceId, nodePath),
      type: 'table',
      version: 1,
      props: {
        headers,
        rows: dataRows,
        ...(caption
          ? { caption: collapseWhitespace(textContent(caption)) }
          : {}),
      },
    },
    context,
  );
}

function addImage(
  element: HtmlElement,
  nodePath: string,
  context: ConversionContext,
): void {
  const src = getAttribute(element, 'src');
  const alt = getAttribute(element, 'alt') ?? '';
  if (!src) {
    context.errors.push(
      issue(
        'image_missing_source',
        'Image has no src attribute.',
        context.sourcePath,
      ),
    );
    return;
  }
  try {
    const safeSrc = resolveSourceUrl(src, context.slug, true);
    addBlock(
      {
        id: blockId(context.sourceId, nodePath),
        type: 'image',
        version: 1,
        props: { src: safeSrc, alt },
      },
      context,
    );
  } catch (error) {
    context.errors.push(
      issue('unsafe_image_url', errorMessage(error), context.sourcePath),
    );
  }
}

function inlineChildren(
  node: HtmlNode,
  nodePath: string,
  context: ConversionContext,
): InlineContentNodeV1[] {
  if (isText(node)) return [{ type: 'text', text: node.value }];
  if (!isElement(node)) return [];
  const tag = node.tagName.toLowerCase();
  if (node.namespaceURI === SVG_NAMESPACE || tag === 'svg') {
    context.warnings.push(
      issue(
        'inline_svg_moved_to_code',
        'Inline SVG was preserved as a separate inert code block.',
        context.sourcePath,
      ),
    );
    addSvgBlock(node, nodePath, context);
    return [];
  }
  const children = node.childNodes.flatMap((child, index) =>
    inlineChildren(child, `${nodePath}.${index}`, context),
  );
  if (tag === 'br') return [{ type: 'text', text: '\n' }];
  if (tag === 'strong' || tag === 'b') return wrapInline('bold', children);
  if (tag === 'em' || tag === 'i') return wrapInline('italic', children);
  if (tag === 'code') return wrapInline('inline_code', children);
  if (tag === 'img') {
    context.errors.push(
      issue(
        'unsupported_inline_image',
        'Images nested inside inline content cannot preserve block order; move the image outside the paragraph.',
        context.sourcePath,
      ),
    );
    return [];
  }
  if (tag === 'a') {
    const href = getAttribute(node, 'href');
    if (!href) return children;
    try {
      return wrapLink(resolveSourceUrl(href, context.slug, false), children);
    } catch (error) {
      context.errors.push(
        issue('unsafe_link_url', errorMessage(error), context.sourcePath),
      );
      return children;
    }
  }
  if (!['span', 'small', 'label', 'p', 'figcaption', 'li'].includes(tag)) {
    context.warnings.push(
      issue(
        'unsupported_inline_element_unwrapped',
        `<${tag}> formatting was not preserved; visible text was retained.`,
        context.sourcePath,
      ),
    );
  }
  return children;
}

function wrapInline(
  type: 'bold' | 'italic' | 'inline_code',
  children: InlineContentNodeV1[],
): InlineContentNodeV1[] {
  return children.length > 0 ? [{ type, children }] : [];
}

function wrapLink(
  href: string,
  children: InlineContentNodeV1[],
): InlineContentNodeV1[] {
  return children.length > 0 ? [{ type: 'link', href, children }] : [];
}

function compactInlineWhitespace(
  nodes: InlineContentNodeV1[],
): InlineContentNodeV1[] {
  return nodes.filter((node, index) => {
    if (node.type !== 'text' || node.text.trim()) return true;
    return index > 0 && index < nodes.length - 1;
  });
}

function hasVisibleInlineText(node: InlineContentNodeV1): boolean {
  if (node.type === 'text') return node.text.trim().length > 0;
  return node.children.some(hasVisibleInlineText);
}

function addBlock(block: ContentBlockV1, context: ConversionContext): void {
  if (context.blocks.length >= 500) {
    context.errors.push(
      issue(
        'too_many_content_blocks',
        'Converted article exceeds the 500-block V1 limit.',
        context.sourcePath,
      ),
    );
    return;
  }
  context.blocks.push(block);
}

function relatedContentBlock(
  article: GitContentSourceArticle,
  articleById: Map<string, GitContentSourceArticle>,
  sourcePath: string,
): { block?: ContentBlockV1; issue?: GitContentImportIssue } {
  if (article.relationships.related.length === 0) return {};
  if (article.relationships.related.length > 20) {
    return {
      issue: issue(
        'too_many_related_articles',
        'Related content exceeds the V1 limit of 20 items.',
        sourcePath,
      ),
    };
  }
  const items: { title: string; href: string; description?: string }[] = [];
  for (const relatedId of article.relationships.related) {
    const related = articleById.get(relatedId);
    if (!related?.title || !related.slug) {
      return {
        issue: issue(
          'unresolved_related_article',
          `Related article ${relatedId} has no importable title or URL.`,
          sourcePath,
        ),
      };
    }
    items.push({
      title: related.title,
      href: `/${related.slug}/`,
      ...(related.description && related.description.length <= 500
        ? { description: related.description }
        : {}),
    });
  }
  return {
    block: {
      id: blockId(
        article.sourceId ?? article.contentKey ?? sourcePath,
        'related',
      ),
      type: 'related_content',
      version: 1,
      props: { items },
    },
  };
}

function resolveSourceUrl(value: string, slug: string, image: boolean): string {
  const input = value.trim();
  if (!input) throw new Error('URL is empty.');
  if (input.startsWith('//') || input.includes('\\')) {
    throw new Error('Protocol-relative URLs and backslashes are not allowed.');
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(input) && !/^https?:\/\//i.test(input)) {
    throw new Error('Executable or unsupported URL schemes are not allowed.');
  }
  let normalized = input;
  if (
    !input.startsWith('/') &&
    !input.startsWith('#') &&
    !/^https?:\/\//i.test(input)
  ) {
    const resolved = new URL(input, `${LOCAL_ORIGIN}/${slug}/`);
    normalized = `${resolved.pathname}${resolved.search}${resolved.hash}`;
  }
  if (/^https?:\/\//i.test(normalized)) {
    const parsed = new URL(normalized);
    if (
      (parsed.protocol !== 'https:' &&
        (image || parsed.protocol !== 'http:')) ||
      parsed.username ||
      parsed.password
    ) {
      throw new Error(
        'URL must be a safe local path or credential-free HTTP(S) URL.',
      );
    }
    return normalized;
  }
  if (image && !normalized.startsWith('/')) {
    throw new Error('Image sources must be local paths or HTTPS URLs.');
  }
  if (normalized.startsWith('//') || !normalized.startsWith('/')) {
    if (!normalized.startsWith('#') || image) {
      throw new Error('URL must be a local path, fragment, or HTTP(S) URL.');
    }
  }
  const resolved = new URL(normalized, LOCAL_ORIGIN);
  if (
    resolved.origin !== LOCAL_ORIGIN ||
    resolved.username ||
    resolved.password
  ) {
    throw new Error('URL must not contain credentials or an external origin.');
  }
  return normalized;
}

function normalizeCodeLanguage(
  value: string,
  context: ConversionContext,
): string {
  const language = value.trim().toLowerCase().split(/\s+/, 1)[0] ?? '';
  if (/^[a-z0-9][a-z0-9+#._-]{0,39}$/.test(language)) return language;
  if (value.trim()) {
    context.warnings.push(
      issue(
        'code_language_normalized',
        `Code label ${value.trim()} was replaced with text.`,
        context.sourcePath,
      ),
    );
  }
  return 'text';
}

function blockId(sourceId: string, nodePath: string): string {
  return `b-${sha256(`${sourceId}:${nodePath}`).slice(0, 24)}`;
}

function nextMeaningfulNode(
  nodes: HtmlNode[],
  fromIndex: number,
): { node: HtmlNode; index: number } | null {
  for (let index = fromIndex; index < nodes.length; index += 1) {
    const node = nodes[index];
    if (!node || (isText(node) && !node.value.trim())) continue;
    return { node, index };
  }
  return null;
}

function directCells(element: HtmlElement, tag: 'td' | 'th'): HtmlElement[] {
  return element.childNodes.flatMap((node) => {
    if (!isElement(node)) return [];
    if (node.tagName.toLowerCase() === tag) return [node];
    if (['thead', 'tbody', 'tr'].includes(node.tagName.toLowerCase())) {
      return directCells(node, tag);
    }
    return [];
  });
}

function descendants(element: HtmlElement, tag: string): HtmlElement[] {
  const found: HtmlElement[] = [];
  const visit = (node: HtmlNode): void => {
    if (!isElement(node)) return;
    if (node.tagName.toLowerCase() === tag) found.push(node);
    for (const child of node.childNodes) visit(child);
  };
  visit(element);
  return found;
}

function findFirstElement(
  element: HtmlElement,
  tag: string,
): HtmlElement | undefined {
  return descendants(element, tag)[0];
}

function containsElement(element: HtmlElement, tag: string): boolean {
  return descendants(element, tag).length > 0;
}

function textContent(node: HtmlNode): string {
  if (isText(node)) return node.value;
  if (!isElement(node) && !('childNodes' in node)) return '';
  return node.childNodes.map(textContent).join('');
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function getAttribute(element: HtmlElement, name: string): string | undefined {
  return element.attrs.find(
    (attribute) => attribute.name.toLowerCase() === name.toLowerCase(),
  )?.value;
}

function hasClass(element: HtmlElement, name: string): boolean {
  return (getAttribute(element, 'class') ?? '').split(/\s+/).includes(name);
}

function isElement(node: HtmlNode): node is HtmlElement {
  return 'tagName' in node && 'childNodes' in node;
}

function isText(node: HtmlNode): node is HtmlText {
  return node.nodeName === '#text' && 'value' in node;
}

function walkFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const itemPath = path.join(directory, entry.name);
    return entry.isDirectory()
      ? walkFiles(itemPath)
      : entry.isFile()
        ? [itemPath]
        : [];
  });
}

function readBoundedFile(filePath: string): string {
  const contents = readFileSync(filePath, 'utf8');
  if (Buffer.byteLength(contents, 'utf8') > MAX_SOURCE_FILE_BYTES) {
    throw new Error(
      `Source file exceeds ${MAX_SOURCE_FILE_BYTES} UTF-8 bytes.`,
    );
  }
  return contents;
}

function toSourcePath(root: string, filePath: string): string {
  return path.relative(root, filePath).split(path.sep).join('/');
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function assertAllowedKeys(
  value: Record<string, unknown>,
  allowed: string[],
): void {
  const unsupported = Object.keys(value).find((key) => !allowed.includes(key));
  if (unsupported)
    throw new Error(`Metadata field ${unsupported} has no importer mapping.`);
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

function issue(
  code: string,
  message: string,
  sourcePath: string,
): GitContentImportIssue {
  return { code, message, sourcePath };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown import error.';
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}
