import { createHash, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseService } from '../../../src/database/database.service.js';
import { PlatformAuthorizationRepository } from '../../../src/modules/identity/platform-authorization/repositories/platform-authorization.repository.js';
import { PlatformAuthorizationService } from '../../../src/modules/identity/platform-authorization/services/platform-authorization.service.js';
import type { AuthenticatedPrincipal } from '../../../src/modules/identity/authentication/types/authenticated-principal.js';
import { ContentCatalogRepository } from '../../../src/modules/content/catalog/repositories/content-catalog.repository.js';
import { ContentCatalogService } from '../../../src/modules/content/catalog/services/content-catalog.service.js';
import {
  ContentLifecycleTransitionError,
  ContentPermissionDeniedError,
  ContentRevisionConflictError,
  ContentSlugConflictError,
} from '../../../src/modules/content/catalog/types/content-catalog.types.js';
import { ContentDocumentValidationError } from '../../../src/modules/content/catalog/types/content-document.js';
import { ContentSlugValidationError } from '../../../src/modules/content/catalog/types/content-slug.js';
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
    const slug = `transactional-outbox-${randomUUID()}`;
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
    const slug = `unique-route-${randomUUID()}`;
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
    ).rejects.toBeInstanceOf(ContentSlugValidationError);
    await expect(
      service.createArticle(
        `article:${randomUUID()}`,
        'unsafe-link',
        makeDocument('Unsafe link', 'javascript:alert(1)'),
        actor,
      ),
    ).rejects.toBeInstanceOf(ContentDocumentValidationError);
    await expect(
      service.createArticle(
        `article:${randomUUID()}`,
        'unauthorized-route',
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
