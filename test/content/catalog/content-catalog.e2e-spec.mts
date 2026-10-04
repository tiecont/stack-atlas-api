import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { configureHttp } from '../../../src/app.config.js';
import { AppModule } from '../../../src/app.module.js';
import { DATABASE_POOL } from '../../../src/database/database.constants.js';
import { checksumContent } from '../../../src/modules/content/catalog/helpers/content-checksum.js';
import { ContentCatalogRepository } from '../../../src/modules/content/catalog/repositories/content-catalog.repository.js';
import { PlatformAuthorizationService } from '../../../src/modules/identity/platform-authorization/services/platform-authorization.service.js';
import { ContentCatalogService } from '../../../src/modules/content/catalog/services/content-catalog.service.js';
import { validateContentDocument } from '../../../src/modules/content/catalog/types/content-document.js';
import {
  CANONICAL_ARTICLE_SLUG_PATTERN,
  isCanonicalArticleSlug,
} from '../../../src/modules/content/catalog/types/content-slug.js';
import { migrate } from '../../../scripts/migrations/runner.mjs';
import { requirePostgresTestDatabaseUrl } from '../../postgres-test-safety.js';

const databaseUrl = requirePostgresTestDatabaseUrl();
const allowedOrigin = 'https://learn.example';

function responseCookies(headers: Record<string, unknown>): string[] {
  const value = headers['set-cookie'];
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string');
  }
  return typeof value === 'string' ? [value] : [];
}

function stringProperty(value: unknown, property: string): string {
  if (!isRecord(value) || typeof value[property] !== 'string') {
    throw new Error(`Expected response property "${property}" to be a string.`);
  }
  return value[property];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function recordProperty(
  value: unknown,
  property: string,
): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  const result = value[property];
  return isRecord(result) ? result : null;
}

async function createAccountAndLogin(
  app: INestApplication,
  label: string,
): Promise<{ accountId: string; cookie: string; email: string }> {
  const email = `${label}-${randomUUID()}@example.test`;
  const password = 'a-test-password-with-enough-length';
  const created = await request(app.getHttpServer())
    .post('/api/v1/account')
    .set('Origin', allowedOrigin)
    .send({ email, password })
    .expect(201);
  const accountId = stringProperty(created.body, 'id');
  const login = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .set('Origin', allowedOrigin)
    .send({ email, password })
    .expect(200);
  const cookie = responseCookies(login.headers).find((item) =>
    item.startsWith('stack_atlas_session='),
  );
  if (!cookie) throw new Error('Login did not issue the session cookie.');
  return { accountId, cookie: cookie.split(';', 1)[0]!, email };
}

function contentDocument(title: string): Record<string, unknown> {
  return {
    schema_version: 1,
    title,
    description: `${title} description`,
    blocks: [
      {
        id: 'body',
        type: 'rich_text',
        version: 1,
        props: {
          nodes: [
            {
              type: 'paragraph',
              children: [{ type: 'text', text: `${title} body` }],
            },
          ],
        },
      },
    ],
  };
}

describe('content catalog HTTP and PostgreSQL flow', () => {
  let app: INestApplication;
  let pool: Pool;
  const originalEnvironment = new Map<string, string | undefined>();

  const setEnvironment = (key: string, value: string) => {
    originalEnvironment.set(key, process.env[key]);
    process.env[key] = value;
  };

  beforeAll(async () => {
    setEnvironment('NODE_ENV', 'test');
    setEnvironment('DATABASE_URL', databaseUrl);
    setEnvironment('CORS_ORIGINS', allowedOrigin);
    await migrate('up', databaseUrl);
    await migrate('data-up', databaseUrl);
    pool = new Pool({ connectionString: databaseUrl });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DATABASE_POOL)
      .useValue(pool)
      .compile();
    app = moduleRef.createNestApplication();
    configureHttp(app);
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    for (const [key, value] of originalEnvironment) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('enforces permissions and completes create, revision, review, publish, public read, and archive', async () => {
    const catalogNotReady = await request(app.getHttpServer())
      .get('/api/v1/content/catalog')
      .expect(503)
      .expect('Content-Type', /application\/problem\+json/);
    expect(catalogNotReady.body).toMatchObject({
      code: 'content_catalog_not_ready',
      status: 503,
    });

    const anonymous = await request(app.getHttpServer())
      .get('/api/v1/admin/content')
      .expect(401);
    expect(anonymous.headers['content-type']).toMatch(
      /application\/problem\+json/,
    );

    const editor = await createAccountAndLogin(app, 'content-editor');
    const publisher = await createAccountAndLogin(app, 'content-publisher');
    const viewer = await createAccountAndLogin(app, 'content-viewer');
    const authorization = app.get(PlatformAuthorizationService);
    await authorization.changeRoleAssignment(
      editor.accountId,
      'content-editor',
      true,
    );
    await authorization.changeRoleAssignment(
      publisher.accountId,
      'content-editor',
      true,
    );
    await authorization.changeRoleAssignment(
      publisher.accountId,
      'content-publisher',
      true,
    );

    await request(app.getHttpServer())
      .get('/api/v1/admin/content')
      .set('Cookie', viewer.cookie)
      .expect(403)
      .expect('Content-Type', /application\/problem\+json/);

    const slug = `articles/architecture/e2e-${randomUUID()}`;
    const contentKey = `article:${randomUUID()}`;
    const firstDocument = contentDocument('First revision');
    const created = await request(app.getHttpServer())
      .post('/api/v1/admin/content')
      .set('Origin', allowedOrigin)
      .set('Cookie', editor.cookie)
      .send({
        contentKey,
        slug,
        document: firstDocument,
      })
      .expect(201);
    expect(created.body).toMatchObject({
      slug,
      status: 'DRAFT',
      revisionNumber: 1,
      document: firstDocument,
      createdBy: editor.accountId,
      revisionCreatedBy: editor.accountId,
    });
    const contentId = stringProperty(created.body, 'contentId');
    const firstRevisionId = stringProperty(created.body, 'revisionId');

    await request(app.getHttpServer())
      .get(`/api/v1/content/${encodeURIComponent(slug)}`)
      .expect(404);
    const draftSearch = await request(app.getHttpServer())
      .get('/api/v1/content/search')
      .query({ q: 'First revision' })
      .expect(200);
    expect(draftSearch.body.items).toEqual([]);

    const item = await request(app.getHttpServer())
      .get(`/api/v1/admin/content/${contentId}`)
      .set('Cookie', editor.cookie)
      .expect(200);
    expect(item.body).toMatchObject({
      contentId,
      slug,
      status: 'DRAFT',
      latestRevisionId: firstRevisionId,
    });

    const list = await request(app.getHttpServer())
      .get('/api/v1/admin/content?status=DRAFT&limit=100')
      .set('Cookie', editor.cookie)
      .expect(200);
    expect(list.body.items).toEqual(
      expect.arrayContaining([expect.objectContaining({ contentId, slug })]),
    );
    await request(app.getHttpServer())
      .get('/api/v1/admin/content?cursor=invalid')
      .set('Cookie', editor.cookie)
      .expect(400);

    const revisionList = await request(app.getHttpServer())
      .get(`/api/v1/admin/content/${contentId}/revisions`)
      .set('Cookie', editor.cookie)
      .expect(200);
    expect(revisionList.body.items).toEqual([
      expect.objectContaining({
        contentId,
        revisionId: firstRevisionId,
        revisionNumber: 1,
        revisionCreatedBy: editor.accountId,
      }),
    ]);

    const firstPreview = await request(app.getHttpServer())
      .get(`/api/v1/admin/content/${contentId}/revisions/${firstRevisionId}`)
      .set('Cookie', editor.cookie)
      .expect(200)
      .expect('Content-Type', /application\/json/);
    expect(firstPreview.body.document).toEqual(firstDocument);

    const secondDocument = contentDocument('Second revision');
    const second = await request(app.getHttpServer())
      .post(`/api/v1/admin/content/${contentId}/revisions`)
      .set('Origin', allowedOrigin)
      .set('Cookie', editor.cookie)
      .send({ baseRevisionId: firstRevisionId, document: secondDocument })
      .expect(201);
    expect(second.body).toMatchObject({
      revisionNumber: 2,
      status: 'DRAFT',
      document: secondDocument,
    });
    const secondRevisionId = stringProperty(second.body, 'revisionId');

    const revisionPage = await request(app.getHttpServer())
      .get(`/api/v1/admin/content/${contentId}/revisions?limit=1`)
      .set('Cookie', editor.cookie)
      .expect(200);
    expect(revisionPage.body.items).toHaveLength(1);
    expect(revisionPage.body.items[0]?.revisionId).toBe(secondRevisionId);
    expect(revisionPage.body.nextCursor).toBe('2');
    const previousRevisionPage = await request(app.getHttpServer())
      .get(
        `/api/v1/admin/content/${contentId}/revisions?limit=1&cursor=${revisionPage.body.nextCursor}`,
      )
      .set('Cookie', editor.cookie)
      .expect(200);
    expect(previousRevisionPage.body.items).toEqual([
      expect.objectContaining({
        revisionId: firstRevisionId,
        revisionNumber: 1,
      }),
    ]);

    const stale = await request(app.getHttpServer())
      .post(`/api/v1/admin/content/${contentId}/revisions`)
      .set('Origin', allowedOrigin)
      .set('Cookie', editor.cookie)
      .send({
        baseRevisionId: firstRevisionId,
        document: contentDocument('Stale'),
      })
      .expect(409)
      .expect('Content-Type', /application\/problem\+json/);
    expect(stale.body).toMatchObject({
      code: 'content_revision_conflict',
      status: 409,
    });
    const revisionState = await pool.query<{
      latest_revision_id: string;
      revision_count: string;
    }>(
      `SELECT item.latest_revision_id, count(revision.id)::text AS revision_count
       FROM stack_atlas.content_items AS item
       JOIN stack_atlas.content_revisions AS revision
         ON revision.content_item_id = item.id
       WHERE item.id = $1
       GROUP BY item.id`,
      [contentId],
    );
    expect(revisionState.rows[0]).toEqual({
      latest_revision_id: secondRevisionId,
      revision_count: '2',
    });

    const reviewResponse = await request(app.getHttpServer())
      .post(`/api/v1/admin/content/${contentId}/submit-for-review`)
      .set('Origin', allowedOrigin)
      .set('Cookie', editor.cookie)
      .expect(200);
    expect(reviewResponse.body).toMatchObject({
      contentId,
      contentKey: created.body.contentKey,
      slug,
      status: 'IN_REVIEW',
      latestRevisionId: secondRevisionId,
      publishedRevisionId: null,
      createdBy: editor.accountId,
      archivedAt: null,
      archivedBy: null,
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });

    await request(app.getHttpServer())
      .post(`/api/v1/admin/content/${contentId}/publish`)
      .set('Origin', allowedOrigin)
      .set('Cookie', editor.cookie)
      .send({ revisionId: secondRevisionId })
      .expect(403);

    const secondContent = await request(app.getHttpServer())
      .post('/api/v1/admin/content')
      .set('Origin', allowedOrigin)
      .set('Cookie', editor.cookie)
      .send({
        contentKey: `article:${randomUUID()}`,
        slug: `articles/architecture/cross-item-${randomUUID()}`,
        document: contentDocument('Other content'),
      })
      .expect(201);
    const secondContentId = stringProperty(secondContent.body, 'contentId');

    const firstContentPage = await request(app.getHttpServer())
      .get('/api/v1/admin/content?limit=1')
      .set('Cookie', editor.cookie)
      .expect(200);
    expect(firstContentPage.body.items).toHaveLength(1);
    expect(typeof firstContentPage.body.nextCursor).toBe('string');
    const secondContentPage = await request(app.getHttpServer())
      .get(
        `/api/v1/admin/content?limit=1&cursor=${firstContentPage.body.nextCursor}`,
      )
      .set('Cookie', editor.cookie)
      .expect(200);
    expect(secondContentPage.body.items).toHaveLength(1);
    const firstPageIds = [
      firstContentPage.body.items[0]?.contentId,
      secondContentPage.body.items[0]?.contentId,
    ].sort();
    expect(firstPageIds).toEqual([contentId, secondContentId].sort());
    await request(app.getHttpServer())
      .post(`/api/v1/admin/content/${secondContentId}/submit-for-review`)
      .set('Origin', allowedOrigin)
      .set('Cookie', editor.cookie)
      .expect(200);

    await request(app.getHttpServer())
      .post(`/api/v1/admin/content/${secondContentId}/publish`)
      .set('Origin', allowedOrigin)
      .set('Cookie', publisher.cookie)
      .send({ revisionId: secondRevisionId })
      .expect(404);
    const secondContentState = await pool.query<{
      status: string;
      published_revision_id: string | null;
    }>(
      'SELECT status, published_revision_id FROM stack_atlas.content_items WHERE id = $1',
      [secondContentId],
    );
    expect(secondContentState.rows[0]).toEqual({
      status: 'IN_REVIEW',
      published_revision_id: null,
    });

    const published = await request(app.getHttpServer())
      .post(`/api/v1/admin/content/${contentId}/publish`)
      .set('Origin', allowedOrigin)
      .set('Cookie', publisher.cookie)
      .send({ revisionId: secondRevisionId })
      .expect(200);
    expect(published.body).toMatchObject({
      contentId,
      revisionId: secondRevisionId,
      status: 'PUBLISHED',
      publishedBy: publisher.accountId,
      document: secondDocument,
    });
    expect(Date.parse(published.body.publishedAt)).not.toBeNaN();

    const publication = await pool.query<{
      revision_id: string;
      published_by: string;
      published_at: Date;
      published_revision_id: string;
      status: string;
    }>(
      `SELECT publication.revision_id, publication.published_by,
              publication.published_at, item.published_revision_id, item.status
       FROM stack_atlas.content_publications AS publication
       JOIN stack_atlas.content_items AS item
         ON item.id = publication.content_item_id
       WHERE item.id = $1
       ORDER BY publication.published_at DESC
       LIMIT 1`,
      [contentId],
    );
    expect(publication.rows[0]).toMatchObject({
      revision_id: secondRevisionId,
      published_by: publisher.accountId,
      published_revision_id: secondRevisionId,
      status: 'PUBLISHED',
    });
    expect(publication.rows[0]?.published_at).toBeInstanceOf(Date);

    const publicContent = await request(app.getHttpServer())
      .get(`/api/v1/content/${encodeURIComponent(slug)}`)
      .expect(200)
      .expect('Cache-Control', 'no-store')
      .expect('Content-Type', /application\/json/);
    expect(publicContent.body).toMatchObject({
      contentId,
      slug,
      publishedRevisionId: secondRevisionId,
      document: secondDocument,
      seo: {
        title: 'Second revision',
        description: 'Second revision description',
      },
    });
    expect(publicContent.body).not.toHaveProperty('html');

    const session = await pool.query<{ id: string }>(
      `SELECT id FROM stack_atlas.sessions
       WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now()
       ORDER BY expires_at DESC LIMIT 1`,
      [publisher.accountId],
    );
    const sessionId = session.rows[0]?.id;
    if (!sessionId) throw new Error('Expected an active editor session.');
    const sourceId = contentKey.slice('article:'.length);
    const legacySourceId = `legacy-${randomUUID().replaceAll('-', '')}`;
    const legacyContentKey = `article:${legacySourceId}`;
    const legacySlug = `engineering/legacy-${randomUUID().replaceAll('-', '')}`;
    const legacyDocument = validateContentDocument(
      contentDocument('Legacy Second revision'),
    );
    const legacyPublished = await app
      .get(ContentCatalogRepository)
      .createPublishedArticle({
        contentKey: legacyContentKey,
        slug: legacySlug,
        actorAccountId: publisher.accountId,
        document: legacyDocument,
        checksumSha256: checksumContent(legacyDocument),
      });
    const canonicalLegacyUrl = `/season-01-guides/${sourceId}.html`;
    const legacyLegacyUrl = `/season-01-guides/${legacySourceId}.html`;
    const sourceCommitSha = `${randomUUID().replaceAll('-', '')}${'0'.repeat(8)}`;
    const catalogSnapshot = {
      schema_version: 1,
      site: { name: 'Stack Atlas', description: 'Engineering knowledge.', language: 'vi' },
      topics: [{ id: 'architecture', title: 'Architecture', description: 'System boundaries.' }],
      categories: [{ id: 'engineering', title: 'Engineering' }],
      paths: [{
        id: 'backend',
        title: 'Backend',
        description: 'Backend learning path.',
        legacyIndexUrls: [],
        modules: [{
          id: 'foundations',
          title: 'Foundations',
          order: 1,
          domain: 'architecture',
          category: 'engineering',
          articleIds: [legacySourceId, sourceId],
          legacyIndexUrls: [],
        }],
      }],
      articles: [
        {
          sourceId: legacySourceId,
          contentKey: legacyContentKey,
          domain: 'architecture',
          category: 'engineering',
          tags: ['e2e'],
          difficulty: 'unspecified',
          learningPaths: [{ pathId: 'backend', moduleId: 'foundations' }],
          prerequisites: [],
          related: [],
          labs: [],
          authors: ['test'],
          kubernetes: null,
          review: null,
          legacyUrls: [legacyLegacyUrl],
        },
        {
          sourceId,
          contentKey,
          domain: 'architecture',
          category: 'engineering',
          tags: ['e2e'],
          difficulty: 'unspecified',
          learningPaths: [{ pathId: 'backend', moduleId: 'foundations' }],
          prerequisites: [legacySourceId],
          related: [legacySourceId],
          labs: [],
          authors: ['test'],
          kubernetes: null,
          review: null,
          legacyUrls: [canonicalLegacyUrl],
        },
      ],
      redirects: [],
    };
    await app.get(ContentCatalogService).storeGitContentCatalogSnapshot(
      sourceCommitSha,
      catalogSnapshot,
      { accountId: publisher.accountId, sessionId, email: publisher.email },
    );
    const legacyAdminItem = await request(app.getHttpServer())
      .get(`/api/v1/admin/content/${legacyPublished.contentId}`)
      .set('Cookie', editor.cookie)
      .expect(200);
    expect(legacyAdminItem.body).toMatchObject({
      contentId: legacyPublished.contentId,
      slug: legacySlug,
      status: 'PUBLISHED',
    });
    const legacyAdminRevision = await request(app.getHttpServer())
      .get(
        `/api/v1/admin/content/${legacyPublished.contentId}/revisions/${legacyPublished.revisionId}`,
      )
      .set('Cookie', editor.cookie)
      .expect(200);
    expect(legacyAdminRevision.body.slug).toBe(legacySlug);

    const contentRowsBeforePublicReads = await pool.query(
      `SELECT id, slug, status, archived_at, published_revision_id
       FROM stack_atlas.content_items
       WHERE id = ANY($1::uuid[])
       ORDER BY id`,
      [[contentId, legacyPublished.contentId]],
    );
    const snapshotBeforePublicReads = await pool.query(
      `SELECT catalog, checksum_sha256
       FROM stack_atlas.content_catalog_snapshots
       WHERE source_commit_sha = $1`,
      [sourceCommitSha],
    );

    const publicCatalog = await request(app.getHttpServer())
      .get('/api/v1/content/catalog')
      .expect(200)
      .expect('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
    expect(publicCatalog.body).toMatchObject({
      schema_version: 1,
      sourceCommitSha,
      site: { name: 'Stack Atlas', language: 'vi' },
      topics: [{ id: 'architecture' }],
      categories: [{ id: 'engineering' }],
      articles: [{
        sourceId,
        contentKey,
        contentId,
        slug,
        publishedRevisionId: secondRevisionId,
        title: 'Second revision',
      }],
    });
    expect(publicCatalog.body.articles).toHaveLength(1);
    expect(
      publicCatalog.body.articles.every((article: { slug: unknown }) =>
        isCanonicalArticleSlug(article.slug),
      ),
    ).toBe(true);
    expect(publicCatalog.body.paths[0].modules[0].articleIds).toEqual([
      sourceId,
    ]);
    expect(publicCatalog.body.articles[0]).toMatchObject({
      prerequisites: [],
      related: [],
    });
    expect(publicCatalog.body.redirects).toContainEqual({
      source: canonicalLegacyUrl,
      destination: `/${slug}/`,
      kind: 'article',
    });
    expect(publicCatalog.body.redirects).not.toContainEqual(
      expect.objectContaining({ source: legacyLegacyUrl }),
    );
    expect(
      publicCatalog.body.redirects.some((redirect: { destination: string }) =>
        redirect.destination.includes(legacySlug),
      ),
    ).toBe(false);

    const search = await request(app.getHttpServer())
      .get('/api/v1/content/search')
      .query({ q: 'Second revision body' })
      .expect(200)
      .expect('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
    expect(search.body.items).toEqual([
      expect.objectContaining({
        contentId,
        contentKey: created.body.contentKey,
        contentType: 'article',
        slug,
        publishedRevisionId: secondRevisionId,
        title: 'Second revision',
        description: 'Second revision description',
      }),
    ]);
    expect(search.body.items[0]).not.toHaveProperty('document');
    expect(search.body.items).toHaveLength(1);
    expect(
      search.body.items.every((item: { slug: unknown }) =>
        isCanonicalArticleSlug(item.slug),
      ),
    ).toBe(true);
    expect(search.body.items.map((item: { contentId: string }) => item.contentId)).toEqual([
      contentId,
    ]);
    const contentRowsAfterPublicReads = await pool.query(
      `SELECT id, slug, status, archived_at, published_revision_id
       FROM stack_atlas.content_items
       WHERE id = ANY($1::uuid[])
       ORDER BY id`,
      [[contentId, legacyPublished.contentId]],
    );
    const snapshotAfterPublicReads = await pool.query(
      `SELECT catalog, checksum_sha256
       FROM stack_atlas.content_catalog_snapshots
       WHERE source_commit_sha = $1`,
      [sourceCommitSha],
    );
    expect(contentRowsAfterPublicReads.rows).toEqual(
      contentRowsBeforePublicReads.rows,
    );
    expect(snapshotAfterPublicReads.rows).toEqual(
      snapshotBeforePublicReads.rows,
    );
    await request(app.getHttpServer())
      .get('/api/v1/content/search')
      .query({ q: 'x'.repeat(161) })
      .expect(400)
      .expect('Content-Type', /application\/problem\+json/);

    await request(app.getHttpServer())
      .post(`/api/v1/admin/content/${contentId}/archive`)
      .set('Origin', allowedOrigin)
      .set('Cookie', editor.cookie)
      .expect(403);
    const archived = await request(app.getHttpServer())
      .post(`/api/v1/admin/content/${contentId}/archive`)
      .set('Origin', allowedOrigin)
      .set('Cookie', publisher.cookie)
      .expect(200);
    expect(archived.body).toMatchObject({
      contentId,
      status: 'ARCHIVED',
      archivedBy: publisher.accountId,
      publishedRevisionId: secondRevisionId,
    });
    await request(app.getHttpServer())
      .get(`/api/v1/content/${encodeURIComponent(slug)}`)
      .expect(404);
    const archivedSearch = await request(app.getHttpServer())
      .get('/api/v1/content/search')
      .query({ q: 'Second revision body' })
      .expect(200);
    expect(archivedSearch.body.items).toEqual([]);
    const archivedCatalog = await request(app.getHttpServer())
      .get('/api/v1/content/catalog')
      .expect(200);
    expect(archivedCatalog.body.articles).toEqual([]);
    await request(app.getHttpServer())
      .get(`/api/v1/content/${encodeURIComponent(secondContent.body.slug)}`)
      .expect(404);

    const archiveHistory = await pool.query<{ publication_count: string }>(
      `SELECT count(*)::text AS publication_count
       FROM stack_atlas.content_publications
       WHERE content_item_id = $1`,
      [contentId],
    );
    expect(archiveHistory.rows[0]?.publication_count).toBe('1');
  }, 30_000);

  it('enforces the canonical route contract at HTTP boundaries', async () => {
    const editor = await createAccountAndLogin(app, 'route-editor');
    const publisher = await createAccountAndLogin(app, 'route-publisher');
    const authorization = app.get(PlatformAuthorizationService);
    await authorization.changeRoleAssignment(
      editor.accountId,
      'content-editor',
      true,
    );
    await authorization.changeRoleAssignment(
      publisher.accountId,
      'content-editor',
      true,
    );
    await authorization.changeRoleAssignment(
      publisher.accountId,
      'content-publisher',
      true,
    );

    const invalidKey = 'article:' + randomUUID();
    const invalidCreate = await request(app.getHttpServer())
      .post('/api/v1/admin/content')
      .set('Origin', allowedOrigin)
      .set('Cookie', editor.cookie)
      .send({
        contentKey: invalidKey,
        slug: 'engineering/new-guide',
        document: contentDocument('Invalid route'),
      })
      .expect(400)
      .expect('Content-Type', /application\/problem\+json/);
    expect(invalidCreate.body).toMatchObject({
      code: 'invalid_content_route',
      status: 400,
      retryable: false,
      detail: 'The article route must match articles/<domain>/<slug>.',
    });
    const invalidCounts = await pool.query<{
      items: string;
      revisions: string;
    }>(
      'SELECT (SELECT count(*)::text FROM stack_atlas.content_items WHERE content_key = $1) AS items, (SELECT count(*)::text FROM stack_atlas.content_revisions AS revision JOIN stack_atlas.content_items AS item ON item.id = revision.content_item_id WHERE item.content_key = $1) AS revisions',
      [invalidKey],
    );
    expect(invalidCounts.rows[0]).toEqual({ items: '0', revisions: '0' });

    const canonicalSlug =
      'articles/architecture/canonical-' + randomUUID();
    const canonicalCreate = await request(app.getHttpServer())
      .post('/api/v1/admin/content')
      .set('Origin', allowedOrigin)
      .set('Cookie', editor.cookie)
      .send({
        contentKey: 'article:' + randomUUID(),
        slug: canonicalSlug,
        document: contentDocument('Canonical route'),
      })
      .expect(201);
    expect(canonicalCreate.body.slug).toBe(canonicalSlug);

    const malformedLookup = await request(app.getHttpServer())
      .get('/api/v1/content/' + encodeURIComponent('engineering/new-guide'))
      .expect(400)
      .expect('Content-Type', /application\/problem\+json/);
    expect(malformedLookup.body).toMatchObject({
      code: 'invalid_content_route',
      status: 400,
      retryable: false,
    });
    await request(app.getHttpServer())
      .get(
        '/api/v1/content/' +
          encodeURIComponent('articles/golang/missing-' + randomUUID()),
      )
      .expect(404)
      .expect('Content-Type', /application\/problem\+json/);

    const historicalDocument = validateContentDocument(
      contentDocument('Historical route'),
    );
    const historical = await app
      .get(ContentCatalogRepository)
      .createArticle({
        contentKey: 'article:' + randomUUID(),
        slug: 'legacy-domain/legacy-article-' + randomUUID(),
        actorAccountId: editor.accountId,
        document: historicalDocument,
        checksumSha256: checksumContent(historicalDocument),
      });
    await request(app.getHttpServer())
      .post(
        '/api/v1/admin/content/' +
          historical.contentId +
          '/submit-for-review',
      )
      .set('Origin', allowedOrigin)
      .set('Cookie', editor.cookie)
      .expect(200);

    const beforePublish = await pool.query<{
      status: string;
      published_revision_id: string | null;
      publication_count: string;
    }>(
      'SELECT item.status, item.published_revision_id, count(publication.id)::text AS publication_count FROM stack_atlas.content_items AS item LEFT JOIN stack_atlas.content_publications AS publication ON publication.content_item_id = item.id WHERE item.id = $1 GROUP BY item.id',
      [historical.contentId],
    );
    const refusedPublish = await request(app.getHttpServer())
      .post('/api/v1/admin/content/' + historical.contentId + '/publish')
      .set('Origin', allowedOrigin)
      .set('Cookie', publisher.cookie)
      .send({ revisionId: historical.revisionId })
      .expect(409)
      .expect('Content-Type', /application\/problem\+json/);
    expect(refusedPublish.body).toMatchObject({
      code: 'content_route_not_publishable',
      status: 409,
      retryable: false,
      detail:
        'The content item does not have a canonical public article route.',
    });
    const afterPublish = await pool.query<{
      status: string;
      published_revision_id: string | null;
      publication_count: string;
    }>(
      'SELECT item.status, item.published_revision_id, count(publication.id)::text AS publication_count FROM stack_atlas.content_items AS item LEFT JOIN stack_atlas.content_publications AS publication ON publication.content_item_id = item.id WHERE item.id = $1 GROUP BY item.id',
      [historical.contentId],
    );
    expect(afterPublish.rows).toEqual(beforePublish.rows);
    expect(afterPublish.rows[0]).toEqual({
      status: 'IN_REVIEW',
      published_revision_id: null,
      publication_count: '0',
    });
  });

  it('documents the complete admin and public content HTTP surface with Problem Details errors', async () => {
    const response = await request(app.getHttpServer())
      .get('/docs-json')
      .expect(200);
    const paths = recordProperty(response.body, 'paths');
    const requiredPaths: ReadonlyArray<readonly [string, string]> = [
      ['/api/v1/admin/content', 'get'],
      ['/api/v1/admin/content', 'post'],
      ['/api/v1/admin/content/{id}', 'get'],
      ['/api/v1/admin/content/{id}/revisions', 'get'],
      ['/api/v1/admin/content/{id}/revisions/{revisionId}', 'get'],
      ['/api/v1/admin/content/{id}/revisions', 'post'],
      ['/api/v1/admin/content/{id}/submit-for-review', 'post'],
      ['/api/v1/admin/content/{id}/publish', 'post'],
      ['/api/v1/admin/content/{id}/archive', 'post'],
      ['/api/v1/content/{slug}', 'get'],
      ['/api/v1/content/catalog', 'get'],
      ['/api/v1/content/search', 'get'],
    ];
    for (const [path, method] of requiredPaths) {
      expect(recordProperty(paths?.[path], method)).not.toBeNull();
    }
    const searchOperation = recordProperty(
      paths?.['/api/v1/content/search'],
      'get',
    );
    const searchResponses = recordProperty(searchOperation, 'responses');
    expect(searchResponses?.['200']).toBeDefined();
    expect(searchResponses?.['400']).toBeDefined();
    const appendOperation = recordProperty(
      paths?.['/api/v1/admin/content/{id}/revisions'],
      'post',
    );
    const appendResponses = recordProperty(appendOperation, 'responses');
    for (const status of ['201', '400', '401', '403', '404', '409']) {
      expect(appendResponses?.[status]).toBeDefined();
    }
    const createOperation = recordProperty(
      paths?.['/api/v1/admin/content'],
      'post',
    );
    const createResponses = recordProperty(createOperation, 'responses');
    expect(recordProperty(createResponses, '400')?.['description']).toContain(
      'invalid_content_route',
    );
    const publishOperation = recordProperty(
      paths?.['/api/v1/admin/content/{id}/publish'],
      'post',
    );
    expect(
      recordProperty(
        recordProperty(publishOperation, 'responses'),
        '409',
      )?.['description'],
    ).toContain('content_route_not_publishable');
    const publicLookupOperation = recordProperty(
      paths?.['/api/v1/content/{slug}'],
      'get',
    );
    expect(
      recordProperty(
        recordProperty(publicLookupOperation, 'responses'),
        '400',
      )?.['description'],
    ).toContain('invalid_content_route');

    const schemas = recordProperty(
      recordProperty(response.body, 'components'),
      'schemas',
    );
    const createProperties = recordProperty(
      schemas?.['CreateContentDto'],
      'properties',
    );
    expect(recordProperty(createProperties, 'slug')).toMatchObject({
      example: 'articles/architecture/transactional-outbox',
      description:
        'Article route normalized and stored as articles/<domain>/<slug>; both segments use lowercase ASCII letters, digits, and single hyphens.',
    });
    const itemProperties = recordProperty(
      schemas?.['ContentItemResponseDto'],
      'properties',
    );
    const itemSlug = recordProperty(itemProperties, 'slug');
    expect(itemSlug?.['pattern']).toBeUndefined();
    expect(itemSlug?.['description']).toContain('New writes are canonical');
    expect(itemSlug?.['description']).toContain(
      'historical rows may remain non-canonical until A01.2 remediation',
    );
    const revisionProperties = recordProperty(
      schemas?.['ContentRevisionResponseDto'],
      'properties',
    );
    const revisionSlug = recordProperty(revisionProperties, 'slug');
    expect(revisionSlug?.['pattern']).toBeUndefined();
    expect(revisionSlug?.['description']).toContain(
      'historical rows may remain non-canonical until A01.2 remediation',
    );
    expect(
      JSON.stringify(schemas?.['PublishedContentResponseDto']),
    ).not.toContain(CANONICAL_ARTICLE_SLUG_PATTERN);
    for (const schemaName of [
      'PublicContentResponseDto',
      'PublicContentSearchItemResponseDto',
      'PublicCatalogArticleResponseDto',
    ]) {
      const properties = recordProperty(schemas?.[schemaName], 'properties');
      expect(recordProperty(properties, 'slug')?.['pattern']).toBe(
        CANONICAL_ARTICLE_SLUG_PATTERN,
      );
    }
    for (const schemaName of ['CreateContentDto', 'CreateContentRevisionDto']) {
      const properties = recordProperty(schemas?.[schemaName], 'properties');
      const document = recordProperty(properties, 'document');
      expect(document?.['$ref']).toBe(
        '#/components/schemas/ContentDocumentResponseDto',
      );
    }
  });
});
