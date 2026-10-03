import { createHash, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseService } from '../../../src/database/database.service.js';
import { checksumContent } from '../../../src/modules/content/catalog/helpers/content-checksum.js';
import { PlatformAuthorizationRepository } from '../../../src/modules/identity/platform-authorization/repositories/platform-authorization.repository.js';
import { PlatformAuthorizationService } from '../../../src/modules/identity/platform-authorization/services/platform-authorization.service.js';
import type { AuthenticatedPrincipal } from '../../../src/modules/identity/authentication/types/authenticated-principal.js';
import { ContentCatalogRepository } from '../../../src/modules/content/catalog/repositories/content-catalog.repository.js';
import { ContentCatalogService } from '../../../src/modules/content/catalog/services/content-catalog.service.js';
import { GitContentImportService } from '../../../src/modules/content/catalog/services/git-content-import.service.js';
import {
  ContentLifecycleTransitionError,
  ContentPermissionDeniedError,
  ContentRevisionConflictError,
  ContentRouteNotPublishableError,
  ContentSlugConflictError,
} from '../../../src/modules/content/catalog/types/content-catalog.types.js';
import { ContentDocumentValidationError } from '../../../src/modules/content/catalog/types/content-document.js';
import { validateContentDocument } from '../../../src/modules/content/catalog/types/content-document.js';
import type {
  GitContentSnapshot,
  GitContentSourceArticle,
} from '../../../src/modules/content/catalog/types/git-content-import.types.js';
import { ContentArticleRouteValidationError } from '../../../src/modules/content/catalog/types/content-slug.js';
import { migrate } from '../../../scripts/migrations/runner.mjs';
import { requirePostgresTestDatabaseUrl } from '../../postgres-test-safety.js';

const databaseUrl = requirePostgresTestDatabaseUrl();
let pool: Pool | undefined;

describe('PostgreSQL content catalog lifecycle', () => {
  beforeAll(async () => {
    await migrate('up', databaseUrl);
    pool = new Pool({ connectionString: databaseUrl });
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('enforces lifecycle transitions, actor attribution, immutable revisions, and archive behavior', async () => {
    const actor = await createActor(pool!, true);
    const service = createService(pool!);
    const contentKey = `article:${randomUUID()}`;
    const slug = `articles/architecture/transactional-outbox-${randomUUID()}`;
    const first = await service.createArticle(
      contentKey,
      slug.toUpperCase(),
      makeDocument('First revision'),
      actor,
    );

    expect(first.slug).toBe(slug);
    expect(first.status).toBe('DRAFT');
    expect(first.createdBy).toBe(actor.accountId);
    expect(first.revisionCreatedBy).toBe(actor.accountId);
    await expect(
      service.publishRevision(first.contentId, first.revisionId, actor),
    ).rejects.toBeInstanceOf(ContentLifecycleTransitionError);

    await expect(
      service.submitForReview(first.contentId, actor),
    ).resolves.toMatchObject({
      status: 'IN_REVIEW',
    });
    await expect(
      service.submitForReview(first.contentId, actor),
    ).rejects.toBeInstanceOf(ContentLifecycleTransitionError);
    await expect(
      service.returnToDraft(first.contentId, actor),
    ).resolves.toMatchObject({
      status: 'DRAFT',
    });
    await service.submitForReview(first.contentId, actor);
    const firstPublication = await service.publishRevision(
      first.contentId,
      first.revisionId,
      actor,
    );
    expect(firstPublication.status).toBe('PUBLISHED');
    expect(firstPublication.publishedAt).toBeInstanceOf(Date);

    await expect(
      service.appendRevision(
        first.contentId,
        first.revisionId,
        makeDocument('Cannot edit published item'),
        actor,
      ),
    ).rejects.toBeInstanceOf(ContentLifecycleTransitionError);

    await service.startDraft(first.contentId, actor);
    const second = await service.appendRevision(
      first.contentId,
      first.revisionId,
      makeDocument('Second revision'),
      actor,
    );
    expect(second.revisionNumber).toBe(2);
    expect(second.revisionCreatedBy).toBe(actor.accountId);
    await expect(
      service.appendRevision(
        first.contentId,
        first.revisionId,
        makeDocument('Stale revision'),
        actor,
      ),
    ).rejects.toBeInstanceOf(ContentRevisionConflictError);
    await service.submitForReview(first.contentId, actor);
    await service.publishRevision(first.contentId, second.revisionId, actor);

    await service.startDraft(first.contentId, actor);
    const competingWrites = await Promise.allSettled([
      service.appendRevision(
        first.contentId,
        second.revisionId,
        makeDocument('Competing revision A'),
        actor,
      ),
      service.appendRevision(
        first.contentId,
        second.revisionId,
        makeDocument('Competing revision B'),
        actor,
      ),
    ]);
    const winners = competingWrites.filter(
      (result) => result.status === 'fulfilled',
    );
    const conflicts = competingWrites.filter(
      (result) => result.status === 'rejected',
    );
    expect(winners).toHaveLength(1);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      status: 'rejected',
      reason: expect.any(ContentRevisionConflictError),
    });
    const winner = winners[0];
    if (!winner || winner.status !== 'fulfilled') {
      throw new Error('Expected exactly one competing revision to succeed.');
    }
    const latestRevisionId = winner.value.revisionId;

    const beforeArchive = await pool!.query<{
      latest_revision_id: string;
      published_revision_id: string;
      revision_count: string;
    }>(
      `SELECT item.latest_revision_id, item.published_revision_id,
              count(revision.id)::text AS revision_count
       FROM stack_atlas.content_items AS item
       JOIN stack_atlas.content_revisions AS revision
         ON revision.content_item_id = item.id
       WHERE item.id = $1
       GROUP BY item.id`,
      [first.contentId],
    );
    expect(beforeArchive.rows[0]).toMatchObject({
      latest_revision_id: latestRevisionId,
      published_revision_id: second.revisionId,
      revision_count: '3',
    });

    const archived = await service.archiveContent(first.contentId, actor);
    expect(archived).toMatchObject({
      status: 'ARCHIVED',
      createdBy: actor.accountId,
      archivedBy: actor.accountId,
      publishedRevisionId: second.revisionId,
    });
    expect(archived.archivedAt).toBeInstanceOf(Date);
    await expect(
      service.archiveContent(first.contentId, actor),
    ).rejects.toBeInstanceOf(ContentLifecycleTransitionError);
    await expect(service.findPublishedByKey(contentKey)).resolves.toBeNull();

    const publicationHistory = await pool!.query<{ revision_id: string }>(
      `SELECT revision_id FROM stack_atlas.content_publications
       WHERE content_item_id = $1`,
      [first.contentId],
    );
    expect(
      publicationHistory.rows.map((row) => row.revision_id).sort(),
    ).toEqual([first.revisionId, second.revisionId].sort());
    const revisionCreators = await pool!.query<{ created_by: string }>(
      `SELECT created_by FROM stack_atlas.content_revisions
       WHERE content_item_id = $1 ORDER BY revision_number`,
      [first.contentId],
    );
    expect(revisionCreators.rows.map((row) => row.created_by)).toEqual([
      actor.accountId,
      actor.accountId,
      actor.accountId,
    ]);

    const restored = await service.restoreArchivedContent(
      first.contentId,
      actor,
    );
    expect(restored).toMatchObject({
      status: 'DRAFT',
      archivedAt: null,
      archivedBy: null,
      publishedRevisionId: second.revisionId,
    });
    await expect(service.findPublishedByKey(contentKey)).resolves.toBeNull();

    await expect(
      pool!.query(
        'UPDATE stack_atlas.content_items SET created_by = $2 WHERE id = $1',
        [first.contentId, randomUUID()],
      ),
    ).rejects.toMatchObject({ code: '55000' });
    await expect(
      pool!.query(
        'UPDATE stack_atlas.content_revisions SET created_by = $2 WHERE id = $1',
        [first.revisionId, randomUUID()],
      ),
    ).rejects.toMatchObject({ code: '55000' });
    await expect(
      pool!.query('DELETE FROM stack_atlas.content_items WHERE id = $1', [
        first.contentId,
      ]),
    ).rejects.toMatchObject({ code: '55000' });
  });

  it('enforces slug uniqueness, reserved routes, URL safety, and server-side permission checks', async () => {
    const actor = await createActor(pool!, true);
    const unprivileged = await createActor(pool!, false);
    const service = createService(pool!);
    const slug = `articles/architecture/unique-route-${randomUUID()}`;
    const first = await service.createArticle(
      `article:${randomUUID()}`,
      slug.toUpperCase(),
      makeDocument('First route'),
      actor,
    );

    await expect(
      service.createArticle(
        `article:${randomUUID()}`,
        slug,
        makeDocument('Slug collision'),
        actor,
      ),
    ).rejects.toBeInstanceOf(ContentSlugConflictError);
    await expect(
      service.createArticle(
        `article:${randomUUID()}`,
        'api/private',
        makeDocument('Reserved route'),
        actor,
      ),
    ).rejects.toBeInstanceOf(ContentArticleRouteValidationError);
    await expect(
      service.createArticle(
        `article:${randomUUID()}`,
        'articles/architecture/unsafe-link',
        makeDocument('Unsafe link', 'javascript:alert(1)'),
        actor,
      ),
    ).rejects.toBeInstanceOf(ContentDocumentValidationError);
    await expect(
      service.createArticle(
        `article:${randomUUID()}`,
        'articles/architecture/unauthorized-route',
        makeDocument('No permission'),
        unprivileged,
      ),
    ).rejects.toBeInstanceOf(ContentPermissionDeniedError);

    await service.archiveContent(first.contentId, actor);
    const replacement = await service.createArticle(
      `article:${randomUUID()}`,
      slug,
      makeDocument('Reused archived route'),
      actor,
    );
    expect(replacement.slug).toBe(slug);
    await expect(
      service.restoreArchivedContent(first.contentId, actor),
    ).rejects.toBeInstanceOf(ContentSlugConflictError);
    const stillArchived = await pool!.query<{
      status: string;
      archived_at: Date | null;
    }>(
      'SELECT status, archived_at FROM stack_atlas.content_items WHERE id = $1',
      [first.contentId],
    );
    expect(stillArchived.rows[0]?.status).toBe('ARCHIVED');
    expect(stillArchived.rows[0]?.archived_at).toBeInstanceOf(Date);
  });

  it('accepts canonical creates and rejects legacy creates before persistence', async () => {
    const actor = await createActor(pool!, true);
    const service = createService(pool!);
    const repository = new ContentCatalogRepository(
      new DatabaseService(pool!),
    );
    const invalidKey = 'article:' + randomUUID();
    await expect(
      service.createArticle(
        invalidKey,
        'engineering/new-guide',
        makeDocument('Invalid route'),
        actor,
      ),
    ).rejects.toBeInstanceOf(ContentArticleRouteValidationError);

    const invalidRows = await pool!.query<{
      items: string;
      revisions: string;
    }>(
      'SELECT (SELECT count(*)::text FROM stack_atlas.content_items WHERE content_key = $1) AS items, (SELECT count(*)::text FROM stack_atlas.content_revisions AS revision JOIN stack_atlas.content_items AS item ON item.id = revision.content_item_id WHERE item.content_key = $1) AS revisions',
      [invalidKey],
    );
    expect(invalidRows.rows[0]).toEqual({ items: '0', revisions: '0' });

    const contentKey = 'article:' + randomUUID();
    const slug = 'articles/architecture/new-guide-' + randomUUID();
    const created = await service.createArticle(
      contentKey,
      slug,
      makeDocument('Canonical route'),
      actor,
    );
    expect(created).toMatchObject({ contentKey, slug, status: 'DRAFT' });

    const historicalDocument = validateContentDocument(
      makeDocument('Historical route'),
    );
    const historical = await repository.createArticle({
      contentKey: 'article:' + randomUUID(),
      slug: 'legacy-domain/legacy-article-' + randomUUID(),
      actorAccountId: actor.accountId,
      document: historicalDocument,
      checksumSha256: checksumContent(historicalDocument),
    });
    await service.submitForReview(historical.contentId, actor);
    const before = await pool!.query<{
      status: string;
      published_revision_id: string | null;
      publication_count: string;
    }>(
      'SELECT item.status, item.published_revision_id, count(publication.id)::text AS publication_count FROM stack_atlas.content_items AS item LEFT JOIN stack_atlas.content_publications AS publication ON publication.content_item_id = item.id WHERE item.id = $1 GROUP BY item.id',
      [historical.contentId],
    );

    await expect(
      service.publishRevision(
        historical.contentId,
        historical.revisionId,
        actor,
      ),
    ).rejects.toBeInstanceOf(ContentRouteNotPublishableError);
    const after = await pool!.query<{
      status: string;
      published_revision_id: string | null;
      publication_count: string;
    }>(
      'SELECT item.status, item.published_revision_id, count(publication.id)::text AS publication_count FROM stack_atlas.content_items AS item LEFT JOIN stack_atlas.content_publications AS publication ON publication.content_item_id = item.id WHERE item.id = $1 GROUP BY item.id',
      [historical.contentId],
    );
    expect(after.rows).toEqual(before.rows);
    expect(after.rows[0]).toEqual({
      status: 'IN_REVIEW',
      published_revision_id: null,
      publication_count: '0',
    });
  });

  it('audits legacy routes and collisions without changing content or catalog state', async () => {
    const actor = await createActor(pool!, true);
    const service = createService(pool!);
    const repository = new ContentCatalogRepository(
      new DatabaseService(pool!),
    );
    const suffix = randomUUID();
    const suggestedSlug = 'articles/architecture/collision-' + suffix;
    await service.createArticle(
      'article:' + randomUUID(),
      suggestedSlug,
      makeDocument('Canonical route owner'),
      actor,
    );

    const firstLegacyDocument = validateContentDocument(
      makeDocument('Archived legacy route'),
    );
    const archivedLegacy = await repository.createArticle({
      contentKey: 'article:' + randomUUID(),
      slug: 'architecture/collision-' + suffix,
      actorAccountId: actor.accountId,
      document: firstLegacyDocument,
      checksumSha256: checksumContent(firstLegacyDocument),
    });
    await service.archiveContent(archivedLegacy.contentId, actor);

    const activeLegacyDocument = validateContentDocument(
      makeDocument('Active legacy route'),
    );
    const activeLegacy = await repository.createArticle({
      contentKey: 'article:' + randomUUID(),
      slug: 'architecture/collision-' + suffix,
      actorAccountId: actor.accountId,
      document: activeLegacyDocument,
      checksumSha256: checksumContent(activeLegacyDocument),
    });

    const generatedDocument = validateContentDocument(
      makeDocument('Generated legacy route'),
    );
    const generated = await repository.createArticle({
      contentKey: 'article:' + randomUUID(),
      slug: 'legacy-' + randomUUID().replaceAll('-', ''),
      actorAccountId: actor.accountId,
      document: generatedDocument,
      checksumSha256: checksumContent(generatedDocument),
    });

    const archivedDocument = validateContentDocument(
      makeDocument('Archived invalid route'),
    );
    const archivedInvalid = await repository.createArticle({
      contentKey: 'article:' + randomUUID(),
      slug: 'old/archived-' + suffix,
      actorAccountId: actor.accountId,
      document: archivedDocument,
      checksumSha256: checksumContent(archivedDocument),
    });
    await service.archiveContent(archivedInvalid.contentId, actor);

    const publishedDocument = validateContentDocument(
      makeDocument('Published invalid route'),
    );
    const publishedInvalid = await repository.createPublishedArticle({
      contentKey: 'article:' + randomUUID(),
      slug: 'published-domain/published-' + suffix,
      actorAccountId: actor.accountId,
      document: publishedDocument,
      checksumSha256: checksumContent(publishedDocument),
    });

    const contentIds = [
      archivedLegacy.contentId,
      activeLegacy.contentId,
      generated.contentId,
      archivedInvalid.contentId,
      publishedInvalid.contentId,
    ].sort();
    const readRows = () =>
      pool!.query(
        'SELECT id, content_key, content_type, slug, status, archived_at, published_revision_id FROM stack_atlas.content_items WHERE id = ANY($1::uuid[]) ORDER BY id',
        [contentIds],
      );
    const readPublicationCounts = () =>
      pool!.query(
        'SELECT item.id, count(publication.id)::text AS publication_count FROM stack_atlas.content_items AS item LEFT JOIN stack_atlas.content_publications AS publication ON publication.content_item_id = item.id WHERE item.id = ANY($1::uuid[]) GROUP BY item.id ORDER BY item.id',
        [contentIds],
      );
    const readActiveSnapshot = () =>
      pool!.query(
        'SELECT snapshot_id FROM stack_atlas.content_catalog_active_snapshot WHERE slot = 1',
      );
    const beforeRows = await readRows();
    const beforePublications = await readPublicationCounts();
    const beforeSnapshot = await readActiveSnapshot();

    const report = await service.preflightArticleRoutes();

    const afterRows = await readRows();
    const afterPublications = await readPublicationCounts();
    const afterSnapshot = await readActiveSnapshot();
    expect(afterRows.rows).toEqual(beforeRows.rows);
    expect(afterPublications.rows).toEqual(beforePublications.rows);
    expect(afterSnapshot.rows).toEqual(beforeSnapshot.rows);
    expect(report.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          contentId: activeLegacy.contentId,
          classification: 'invalid_route',
          reason: 'missing_articles_prefix',
        }),
        expect.objectContaining({
          contentId: generated.contentId,
          reason: 'legacy_generated_slug',
        }),
        expect.objectContaining({
          contentId: archivedInvalid.contentId,
          severity: 'BLOCKER',
        }),
        expect.objectContaining({
          contentId: publishedInvalid.contentId,
          status: 'PUBLISHED',
          severity: 'BLOCKER',
        }),
      ]),
    );
    expect(report.suggestionCollisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'multiple_suggested_routes',
          suggestedSlug,
          candidateContentIds: [
            archivedLegacy.contentId,
            activeLegacy.contentId,
          ].sort(),
        }),
        expect.objectContaining({
          kind: 'active_canonical_route_owner',
          suggestedSlug,
        }),
      ]),
    );
  });

  it('imports a published article atomically, verifies it, and rejects a conflicting rerun', async () => {
    const actor = await createActor(pool!, true);
    const service = createService(pool!);
    const contentKey = `article:git-import-${randomUUID()}`;
    const slug = `articles/architecture/git-import-${randomUUID()}`;
    const imported = await service.createPublishedGitImportArticle(
      { contentKey, slug, document: makeDocument('Imported article') },
      actor,
    );

    expect(imported).toMatchObject({
      contentKey,
      slug,
      status: 'PUBLISHED',
      revisionNumber: 1,
      createdBy: actor.accountId,
      revisionCreatedBy: actor.accountId,
      publishedBy: actor.accountId,
    });
    const state = await service.findGitImportState(contentKey, actor);
    expect(state).toMatchObject({
      contentKey,
      slug,
      status: 'PUBLISHED',
      latestRevisionId: imported.revisionId,
      publishedRevisionId: imported.revisionId,
      latestRevisionChecksumSha256: imported.checksumSha256,
    });
    await expect(
      service.findGitImportStateBySlug(slug, actor),
    ).resolves.toMatchObject({ contentKey, slug });

    const publicationHistory = await pool!.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM stack_atlas.content_publications WHERE content_item_id = $1`,
      [imported.contentId],
    );
    expect(publicationHistory.rows[0]?.count).toBe('1');

    await expect(
      service.createPublishedGitImportArticle(
        { contentKey, slug, document: makeDocument('Imported article') },
        actor,
      ),
    ).rejects.toThrow();
    const afterConflict = await pool!.query<{
      revisions: string;
      publications: string;
    }>(
      `SELECT
         (SELECT count(*)::text FROM stack_atlas.content_revisions WHERE content_item_id = $1) AS revisions,
         (SELECT count(*)::text FROM stack_atlas.content_publications WHERE content_item_id = $1) AS publications`,
      [imported.contentId],
    );
    expect(afterConflict.rows[0]).toEqual({ revisions: '1', publications: '1' });
  });

  it('rolls back the item and revision when publication fails inside the import transaction', async () => {
    const actor = await createActor(pool!, true);
    const service = createService(pool!);
    const contentKey = `article:git-import-rollback-${randomUUID()}`;
    const slug = `articles/architecture/git-import-rollback-${randomUUID()}`;
    await pool!.query(`
      CREATE OR REPLACE FUNCTION stack_atlas.fail_test_git_import_publication()
      RETURNS trigger LANGUAGE plpgsql AS $function$
      BEGIN
        IF NEW.content_item_id IN (
          SELECT id FROM stack_atlas.content_items WHERE content_key = '${contentKey}'
        ) THEN
          RAISE EXCEPTION 'injected import publication failure';
        END IF;
        RETURN NEW;
      END;
      $function$
    `);
    await pool!.query(`
      CREATE TRIGGER fail_test_git_import_publication
      BEFORE INSERT ON stack_atlas.content_publications
      FOR EACH ROW EXECUTE FUNCTION stack_atlas.fail_test_git_import_publication()
    `);
    try {
      await expect(
        service.createPublishedGitImportArticle(
          { contentKey, slug, document: makeDocument('Rollback article') },
          actor,
        ),
      ).rejects.toThrow('injected import publication failure');
    } finally {
      await pool!.query('DROP TRIGGER IF EXISTS fail_test_git_import_publication ON stack_atlas.content_publications');
      await pool!.query('DROP FUNCTION IF EXISTS stack_atlas.fail_test_git_import_publication()');
    }
    const remaining = await pool!.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM stack_atlas.content_items WHERE content_key = $1`,
      [contentKey],
    );
    expect(remaining.rows[0]?.count).toBe('0');
  });

  it('runs dry-run, apply, idempotent rerun, and verify against PostgreSQL', async () => {
    const actor = await createActor(pool!, true);
    const service = createService(pool!);
    const importer = new GitContentImportService(service);
    const sourceId = `git-import-${randomUUID()}`;
    const contentKey = `article:${sourceId}`;
    const slug = `articles/imported/${sourceId}`;
    const snapshot = makeImportSnapshot(sourceId, contentKey, slug);

    const dryRun = await importer.run(snapshot, 'dry-run', actor);
    expect(dryRun.articles[0]?.status).toBe('ready');
    expect(dryRun.summary.imported).toBe(0);
    expect(dryRun.catalogSnapshot.status).toBe('ready');
    expect(dryRun.summary.relationshipMismatches).toBe(0);

    const applied = await importer.run(snapshot, 'apply', actor);
    expect(applied.articles[0]?.status).toBe('imported');
    expect(applied.summary.imported).toBe(1);
    expect(applied.catalogSnapshot.status).toBe('imported');

    const repeated = await importer.run(snapshot, 'apply', actor);
    expect(repeated.articles[0]?.status).toBe('already_imported');
    expect(repeated.summary.imported).toBe(0);
    expect(repeated.catalogSnapshot.status).toBe('already_imported');

    const verified = await importer.run(snapshot, 'verify', actor);
    expect(verified.articles[0]?.status).toBe('verified');
    expect(verified.source.commitSha).toBe(snapshot.commitSha);
    expect(verified.catalogSnapshot.status).toBe('verified');

    const catalogState = await service.findGitContentCatalogImportState(
      snapshot.commitSha,
      actor,
    );
    expect(catalogState).toMatchObject({
      sourceCommitSha: snapshot.commitSha,
      isActive: true,
    });
    const publicCatalog = await service.getPublicContentCatalog();
    expect(publicCatalog.articles).toMatchObject([
      {
        sourceId,
        contentKey,
        domain: 'systems',
        category: 'engineering',
        title: 'Imported article',
        url: `/${slug}/`,
      },
    ]);
    expect(publicCatalog.paths[0]?.modules[0]?.articleIds).toEqual([sourceId]);
    expect(publicCatalog.redirects).toContainEqual({
      source: `/season-10-distributed-systems/${sourceId}.html`,
      destination: `/${slug}/`,
      kind: 'article',
    });

    const persisted = await pool!.query<{
      status: string;
      latest_revision_id: string;
      published_revision_id: string;
      revision_count: string;
      publication_count: string;
    }>(
      `SELECT item.status, item.latest_revision_id, item.published_revision_id,
              (SELECT count(*)::text FROM stack_atlas.content_revisions AS revision
               WHERE revision.content_item_id = item.id) AS revision_count,
              (SELECT count(*)::text FROM stack_atlas.content_publications AS publication
               WHERE publication.content_item_id = item.id) AS publication_count
       FROM stack_atlas.content_items AS item WHERE item.content_key = $1`,
      [contentKey],
    );
    expect(persisted.rows[0]).toMatchObject({
      status: 'PUBLISHED',
      revision_count: '1',
      publication_count: '1',
    });
    expect(persisted.rows[0]?.latest_revision_id).toBe(
      persisted.rows[0]?.published_revision_id,
    );

    const importedState = await service.findGitImportState(contentKey, actor);
    if (!importedState) throw new Error('Expected imported content state.');
    await service.archiveContent(importedState.contentId, actor);
    const archivedCatalog = await service.getPublicContentCatalog();
    expect(archivedCatalog.articles).toEqual([]);
    expect(archivedCatalog.paths[0]?.modules[0]?.articleIds).toEqual([]);
    expect(archivedCatalog.redirects).toEqual([]);
  });
});

function createService(databasePool: Pool): ContentCatalogService {
  const database = new DatabaseService(databasePool);
  return new ContentCatalogService(
    new ContentCatalogRepository(database),
    new PlatformAuthorizationService(
      new PlatformAuthorizationRepository(database),
    ),
  );
}

async function createActor(
  databasePool: Pool,
  grantPlatformAdmin: boolean,
): Promise<AuthenticatedPrincipal> {
  const accountId = randomUUID();
  const sessionId = randomUUID();
  const email = `content-lifecycle-${accountId}@example.test`;
  await databasePool.query(
    'INSERT INTO stack_atlas.users (id, email, password_hash) VALUES ($1, $2, $3)',
    [accountId, email, 'integration-only-hash'],
  );
  await databasePool.query(
    `INSERT INTO stack_atlas.sessions (id, user_id, token_hash, expires_at)
     VALUES ($1, $2, $3, now() + interval '1 hour')`,
    [
      sessionId,
      accountId,
      createHash('sha256').update(randomUUID()).digest('hex'),
    ],
  );
  const principal = { accountId, sessionId, email };
  if (grantPlatformAdmin) {
    const authorization = new PlatformAuthorizationService(
      new PlatformAuthorizationRepository(new DatabaseService(databasePool)),
    );
    await authorization.changeRoleAssignment(accountId, 'platform-admin', true);
  }
  return principal;
}

function makeDocument(title: string, href = '/docs/transactions'): unknown {
  return {
    schema_version: 1,
    title,
    description: 'A content lifecycle integration fixture.',
    blocks: [
      {
        id: 'body',
        type: 'rich_text',
        version: 1,
        props: {
          nodes: [
            {
              type: 'paragraph',
              children: [
                {
                  type: 'link',
                  href,
                  children: [{ type: 'text', text: 'Transactional content' }],
                },
              ],
            },
          ],
        },
      },
    ],
  };
}

function makeImportSnapshot(
  sourceId: string,
  contentKey: string,
  slug: string,
): GitContentSnapshot {
  const document = validateContentDocument(makeDocument('Imported article'));
  const article: GitContentSourceArticle = {
    sourceId,
    contentKey,
    slug,
    title: document.title,
    description: document.description,
    sourceStatus: 'published',
    document,
    sourceFiles: [
      `content/articles/imported/${sourceId}/article.yaml`,
      `content/articles/imported/${sourceId}/article.html`,
    ],
    sourceChecksumSha256: 'a'.repeat(64),
    relationships: {
      domain: 'systems',
      category: 'engineering',
      tags: ['transactional'],
      authors: ['tiecont'],
      difficulty: 'unspecified',
      labs: [],
      kubernetes: null,
      review: null,
      learningPaths: [{ pathId: 'systems', moduleId: 'persistence' }],
      prerequisites: [],
      related: [],
      legacyUrls: [`/season-10-distributed-systems/${sourceId}.html`],
    },
    warnings: [],
    errors: [],
  };
  const pathRecord = {
    id: 'systems',
    title: 'Systems',
    description: 'Systems engineering path.',
    status: 'published',
    sourcePath: 'content/paths/systems.yaml',
    sourceMetadata: { title: 'Systems' },
    legacyIndexUrls: [],
    modules: [
      {
        id: 'persistence',
        title: 'Persistence',
        order: 1,
        domain: 'systems',
        category: 'engineering',
        articleIds: [sourceId],
        legacyIndexUrls: [],
        sourceMetadata: { title: 'Persistence' },
      },
    ],
  };
  return {
    repository: 'tiecont/stack-atlas',
    commitSha: randomUUID().replaceAll('-', '') + '0'.repeat(8),
    sourceRoot: '/tmp/stack-atlas-git-import-test',
    inventory: [
      {
        path: article.sourceFiles[0] ?? '',
        sha256: 'b'.repeat(64),
      },
    ],
    articles: [article],
    pathRecords: [pathRecord],
    catalog: {
      schema_version: 1,
      site: { name: 'Stack Atlas', description: 'Engineering knowledge.', language: 'vi' },
      topics: [{ id: 'systems', title: 'Systems', description: 'Systems engineering.' }],
      categories: [{ id: 'engineering', title: 'Engineering' }],
      paths: [{
        id: pathRecord.id,
        title: pathRecord.title,
        description: pathRecord.description,
        status: pathRecord.status,
        legacyIndexUrls: [],
        modules: pathRecord.modules.map((module) => ({
          id: module.id,
          title: module.title,
          order: module.order,
          domain: module.domain,
          category: module.category,
          articleIds: module.articleIds,
          legacyIndexUrls: module.legacyIndexUrls,
        })),
      }],
      articles: [{
        sourceId,
        contentKey,
        domain: 'systems',
        category: 'engineering',
        tags: ['transactional'],
        difficulty: 'unspecified',
        learningPaths: [{ pathId: 'systems', moduleId: 'persistence' }],
        prerequisites: [],
        related: [],
        labs: [],
        authors: ['tiecont'],
        kubernetes: null,
        review: null,
        legacyUrls: [`/season-10-distributed-systems/${sourceId}.html`],
      }],
      redirects: [{
        source: `/season-10-distributed-systems/${sourceId}.html`,
        destination: `/${slug}/`,
        kind: 'article',
      }],
    },
    sourceErrors: [],
  };
}
