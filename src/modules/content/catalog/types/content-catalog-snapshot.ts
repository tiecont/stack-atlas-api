import type {
  ContentCatalogSnapshotV1,
  ContentCatalogArticleMetadataV1,
  ContentCatalogPathModuleV1,
  ContentCatalogPathV1,
  ContentCatalogRedirectV1,
  ContentCatalogTopicV1,
} from './content-catalog.types';

const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const ARTICLE_REDIRECT_PATTERN =
  /^\/season-\d{2}-[a-z0-9-]+\/[a-z0-9-]+\.html$/;
const MODULE_REDIRECT_PATTERN = /^\/season-\d{2}-[a-z0-9-]+\/index\.html$/;
const MAX_CATALOG_SNAPSHOT_BYTES = 2_097_152;

export class ContentCatalogSnapshotValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContentCatalogSnapshotValidationError';
  }
}

export function validateContentCatalogSnapshot(
  value: unknown,
): ContentCatalogSnapshotV1 {
  const root = asRecord(value, '$');
  exactKeys(
    root,
    [
      'schema_version',
      'site',
      'topics',
      'categories',
      'paths',
      'articles',
      'redirects',
    ],
    '$',
  );
  if (root['schema_version'] !== 1) {
    throw new ContentCatalogSnapshotValidationError(
      '$.schema_version must be 1.',
    );
  }

  const site = asRecord(root['site'], '$.site');
  exactKeys(site, ['name', 'description', 'language'], '$.site');
  const normalizedSite = {
    name: text(site['name'], '$.site.name', 160),
    description: text(site['description'], '$.site.description', 500),
    language: text(site['language'], '$.site.language', 32),
  };

  const topics = array(root['topics'], '$.topics', 200).map((item, index) =>
    validateTopic(item, `$.topics[${index}]`),
  );
  const categories = array(root['categories'], '$.categories', 500).map(
    (item, index) => {
      const path = `$.categories[${index}]`;
      const category = asRecord(item, path);
      exactKeys(category, ['id', 'title'], path);
      return {
        id: id(category['id'], `${path}.id`),
        title: text(category['title'], `${path}.title`, 160),
      };
    },
  );
  const paths = array(root['paths'], '$.paths', 100).map((item, index) =>
    validatePath(item, `$.paths[${index}]`),
  );
  const articles = array(root['articles'], '$.articles', 1000).map(
    (item, index) => validateArticle(item, `$.articles[${index}]`),
  );
  const redirects = array(root['redirects'], '$.redirects', 10000).map(
    (item, index) => validateRedirect(item, `$.redirects[${index}]`),
  );

  assertUnique(
    topics.map((item) => item.id),
    '$.topics ids',
  );
  assertUnique(
    categories.map((item) => item.id),
    '$.categories ids',
  );
  assertUnique(
    paths.map((item) => item.id),
    '$.paths ids',
  );
  assertUnique(
    articles.map((item) => item.sourceId),
    '$.articles sourceIds',
  );
  assertUnique(
    articles.map((item) => item.contentKey),
    '$.articles contentKeys',
  );
  assertUnique(
    redirects.map((item) => item.source),
    '$.redirects sources',
  );

  const snapshot: ContentCatalogSnapshotV1 = {
    schema_version: 1,
    site: normalizedSite,
    topics,
    categories,
    paths,
    articles,
    redirects,
  };
  if (
    Buffer.byteLength(JSON.stringify(snapshot), 'utf8') >
    MAX_CATALOG_SNAPSHOT_BYTES
  ) {
    throw new ContentCatalogSnapshotValidationError(
      `Catalog snapshot exceeds ${MAX_CATALOG_SNAPSHOT_BYTES} UTF-8 bytes.`,
    );
  }
  return snapshot;
}

function validateTopic(value: unknown, path: string): ContentCatalogTopicV1 {
  const topic = asRecord(value, path);
  exactKeys(topic, ['id', 'title', 'description', 'status', 'icon'], path);
  return {
    id: id(topic['id'], `${path}.id`),
    title: text(topic['title'], `${path}.title`, 160),
    description: text(topic['description'], `${path}.description`, 2000),
    ...(topic['status'] === undefined
      ? {}
      : { status: text(topic['status'], `${path}.status`, 32) }),
    ...(topic['icon'] === undefined
      ? {}
      : { icon: text(topic['icon'], `${path}.icon`, 80) }),
  };
}

function validatePath(value: unknown, path: string): ContentCatalogPathV1 {
  const record = asRecord(value, path);
  exactKeys(
    record,
    [
      'id',
      'title',
      'description',
      'status',
      'domain',
      'difficulty',
      'legacyIndexUrls',
      'modules',
    ],
    path,
  );
  const difficulty =
    record['difficulty'] === undefined
      ? undefined
      : asRecord(record['difficulty'], `${path}.difficulty`);
  if (difficulty) exactKeys(difficulty, ['start', 'end'], `${path}.difficulty`);
  const modules = array(record['modules'], `${path}.modules`, 500).map(
    (item, index): ContentCatalogPathModuleV1 => {
      const modulePath = `${path}.modules[${index}]`;
      const module = asRecord(item, modulePath);
      exactKeys(
        module,
        [
          'id',
          'title',
          'order',
          'domain',
          'category',
          'group',
          'articleIds',
          'legacyIndexUrls',
        ],
        modulePath,
      );
      if (!Number.isInteger(module['order']) || Number(module['order']) < 1) {
        throw new ContentCatalogSnapshotValidationError(
          `${modulePath}.order must be a positive integer.`,
        );
      }
      return {
        id: id(module['id'], `${modulePath}.id`),
        title: text(module['title'], `${modulePath}.title`, 160),
        order: Number(module['order']),
        domain: id(module['domain'], `${modulePath}.domain`),
        category: id(module['category'], `${modulePath}.category`),
        ...(module['group'] === undefined
          ? {}
          : { group: text(module['group'], `${modulePath}.group`, 160) }),
        articleIds: stringArray(
          module['articleIds'],
          `${modulePath}.articleIds`,
          500,
          128,
        ),
        legacyIndexUrls: stringArray(
          module['legacyIndexUrls'],
          `${modulePath}.legacyIndexUrls`,
          100,
          512,
        ),
      };
    },
  );
  const pathRecord: ContentCatalogPathV1 = {
    id: id(record['id'], `${path}.id`),
    title: text(record['title'], `${path}.title`, 160),
    description: text(record['description'], `${path}.description`, 2000),
    ...(record['status'] === undefined
      ? {}
      : { status: text(record['status'], `${path}.status`, 32) }),
    ...(record['domain'] === undefined
      ? {}
      : { domain: id(record['domain'], `${path}.domain`) }),
    ...(difficulty
      ? {
          difficulty: {
            start: text(difficulty['start'], `${path}.difficulty.start`, 32),
            end: text(difficulty['end'], `${path}.difficulty.end`, 32),
          },
        }
      : {}),
    legacyIndexUrls: stringArray(
      record['legacyIndexUrls'],
      `${path}.legacyIndexUrls`,
      100,
      512,
    ),
    modules,
  };
  assertUnique(
    modules.map((module) => module.id),
    `${path}.modules ids`,
  );
  return pathRecord;
}

function validateArticle(
  value: unknown,
  path: string,
): ContentCatalogArticleMetadataV1 {
  const article = asRecord(value, path);
  exactKeys(
    article,
    [
      'sourceId',
      'contentKey',
      'domain',
      'category',
      'tags',
      'difficulty',
      'learningPaths',
      'prerequisites',
      'related',
      'labs',
      'authors',
      'kubernetes',
      'review',
      'legacyUrls',
    ],
    path,
  );
  const sourceId = id(article['sourceId'], `${path}.sourceId`);
  const contentKey = text(article['contentKey'], `${path}.contentKey`, 255);
  if (contentKey !== `article:${sourceId}`) {
    throw new ContentCatalogSnapshotValidationError(
      `${path}.contentKey must match its sourceId.`,
    );
  }
  const kubernetes = optionalRecord(
    article['kubernetes'],
    `${path}.kubernetes`,
  );
  const review = optionalRecord(article['review'], `${path}.review`);
  const learningPaths = array(
    article['learningPaths'],
    `${path}.learningPaths`,
    100,
  ).map((value, index) => {
    const membershipPath = `${path}.learningPaths[${index}]`;
    const membership = asRecord(value, membershipPath);
    exactKeys(membership, ['pathId', 'moduleId'], membershipPath);
    return {
      pathId: id(membership['pathId'], `${membershipPath}.pathId`),
      moduleId: id(membership['moduleId'], `${membershipPath}.moduleId`),
    };
  });
  return {
    sourceId,
    contentKey,
    domain: id(article['domain'], `${path}.domain`),
    category:
      article['category'] === null
        ? null
        : id(article['category'], `${path}.category`),
    tags: stringArray(article['tags'], `${path}.tags`, 100, 128),
    difficulty: text(article['difficulty'], `${path}.difficulty`, 32),
    learningPaths,
    prerequisites: stringArray(
      article['prerequisites'],
      `${path}.prerequisites`,
      100,
      128,
    ),
    related: stringArray(article['related'], `${path}.related`, 100, 128),
    labs: stringArray(article['labs'], `${path}.labs`, 100, 128),
    authors: stringArray(article['authors'], `${path}.authors`, 100, 160),
    kubernetes,
    review,
    legacyUrls: stringArray(
      article['legacyUrls'],
      `${path}.legacyUrls`,
      100,
      512,
    ),
  };
}

function validateRedirect(
  value: unknown,
  path: string,
): ContentCatalogRedirectV1 {
  const redirect = asRecord(value, path);
  exactKeys(redirect, ['source', 'destination', 'kind'], path);
  const source = text(redirect['source'], `${path}.source`, 512);
  const destination = text(redirect['destination'], `${path}.destination`, 512);
  const kind = redirect['kind'];
  if (kind !== 'article' && kind !== 'path-module') {
    throw new ContentCatalogSnapshotValidationError(
      `${path}.kind is unsupported.`,
    );
  }
  const sourcePattern =
    kind === 'article' ? ARTICLE_REDIRECT_PATTERN : MODULE_REDIRECT_PATTERN;
  if (
    !sourcePattern.test(source) ||
    source.includes('..') ||
    source.includes('\\')
  ) {
    throw new ContentCatalogSnapshotValidationError(
      `${path}.source is not a supported legacy route.`,
    );
  }
  if (
    !destination.startsWith('/') ||
    destination.startsWith('//') ||
    destination.includes('..') ||
    destination.includes('\\')
  ) {
    throw new ContentCatalogSnapshotValidationError(
      `${path}.destination must be a safe local route.`,
    );
  }
  return { source, destination, kind };
}

function asRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ContentCatalogSnapshotValidationError(
      `${path} must be an object.`,
    );
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: string[],
  path: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      throw new ContentCatalogSnapshotValidationError(
        `${path}.${key} is not supported.`,
      );
    }
  }
  for (const key of allowed) {
    if (!(key in value) && !isOptionalKey(path, key)) {
      throw new ContentCatalogSnapshotValidationError(
        `${path}.${key} is required.`,
      );
    }
  }
}

function isOptionalKey(path: string, key: string): boolean {
  return (
    (path.startsWith('$.topics[') && ['status', 'icon'].includes(key)) ||
    (path.startsWith('$.paths[') &&
      ['status', 'domain', 'difficulty'].includes(key)) ||
    (path.includes('.modules[') && key === 'group')
  );
}

function id(value: unknown, path: string): string {
  const result = text(value, path, 128);
  if (!ID_PATTERN.test(result)) {
    throw new ContentCatalogSnapshotValidationError(
      `${path} must be a lowercase route-safe id.`,
    );
  }
  return result;
}

function text(value: unknown, path: string, maxLength: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    throw new ContentCatalogSnapshotValidationError(
      `${path} must be a non-empty string of at most ${maxLength} characters.`,
    );
  }
  return value;
}

function array(value: unknown, path: string, maxItems: number): unknown[] {
  if (!Array.isArray(value) || value.length > maxItems) {
    throw new ContentCatalogSnapshotValidationError(
      `${path} must be an array with at most ${maxItems} entries.`,
    );
  }
  return value;
}

function stringArray(
  value: unknown,
  path: string,
  maxItems: number,
  maxLength: number,
): string[] {
  return array(value, path, maxItems).map((item, index) =>
    text(item, `${path}[${index}]`, maxLength),
  );
}

function optionalRecord(
  value: unknown,
  path: string,
): Record<string, unknown> | null {
  if (value === null) return null;
  return asRecord(value, path);
}

function assertUnique(values: string[], path: string): void {
  if (new Set(values).size !== values.length) {
    throw new ContentCatalogSnapshotValidationError(`${path} must be unique.`);
  }
}
