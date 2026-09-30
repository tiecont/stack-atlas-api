import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { DatabaseService } from '../../../src/database/database.service.js';
import { ContentCatalogRepository } from '../../../src/modules/content/catalog/repositories/content-catalog.repository.js';
import { ContentCatalogService } from '../../../src/modules/content/catalog/services/content-catalog.service.js';
import { ContentRevisionConflictError } from '../../../src/modules/content/catalog/types/content-catalog.types.js';
import { migrate } from '../../../scripts/migrations/runner.mjs';
import { requirePostgresTestDatabaseUrl } from '../../postgres-test-safety.js';

const databaseUrl = requirePostgresTestDatabaseUrl();
let pool: Pool | undefined;

describe('PostgreSQL content catalog', () => {
  beforeAll(async () => {
    await migrate('up', databaseUrl);
    pool = new Pool({ connectionString: databaseUrl });
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('stores numbered immutable revisions and changes the published pointer transactionally', async () => {
    const database = new DatabaseService(pool!);
    const service = new ContentCatalogService(
      new ContentCatalogRepository(database),
    );
    const contentKey = `article:${randomUUID()}`;
    const first = await service.createArticle(
      contentKey,
      makeDocument('First revision'),
    );
    const firstPublication = await service.publishRevision(
      first.contentId,
      first.revisionId,
    );
    const second = await service.appendRevision(
      first.contentId,
      first.revisionId,
      makeDocument('Second revision'),
    );

    expect(first.revisionNumber).toBe(1);
    expect(second.revisionNumber).toBe(2);
    expect(second.revisionId).not.toBe(first.revisionId);
    expect(firstPublication.revisionId).toBe(first.revisionId);
    expect((await service.findPublishedByKey(contentKey))?.revisionNumber).toBe(
      1,
    );

    const secondPublication = await service.publishRevision(
      first.contentId,
      second.revisionId,
    );
    const published = await service.findPublishedByKey(contentKey);
    expect(secondPublication.revisionId).toBe(second.revisionId);
    expect(published?.revisionNumber).toBe(2);
    expect(published?.document.title).toBe('Second revision');

    const competingWrites = await Promise.allSettled([
      service.appendRevision(
        first.contentId,
        second.revisionId,
        makeDocument('Competing revision A'),
      ),
      service.appendRevision(
        first.contentId,
        second.revisionId,
        makeDocument('Competing revision B'),
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

    await expect(
      service.appendRevision(
        first.contentId,
        first.revisionId,
        makeDocument('Stale revision write'),
      ),
    ).rejects.toBeInstanceOf(ContentRevisionConflictError);

    const revisionCount = await pool!.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM stack_atlas.content_revisions WHERE content_item_id = $1`,
      [first.contentId],
    );
    expect(revisionCount.rows[0]?.count).toBe('3');

    await expect(
      pool!.query(
        `UPDATE stack_atlas.content_revisions SET document = '{}'::jsonb WHERE id = $1`,
        [first.revisionId],
      ),
    ).rejects.toMatchObject({ code: '55000' });
    await expect(
      pool!.query(
        `UPDATE stack_atlas.content_items SET content_key = $2 WHERE id = $1`,
        [first.contentId, `article:renamed-${randomUUID()}`],
      ),
    ).rejects.toMatchObject({ code: '55000' });
    await expect(
      pool!.query('DELETE FROM stack_atlas.content_items WHERE id = $1', [
        first.contentId,
      ]),
    ).rejects.toMatchObject({ code: '55000' });

    const publicationHistory = await pool!.query(
      `SELECT revision_id FROM stack_atlas.content_publications
       WHERE content_item_id = $1 ORDER BY published_at, id`,
      [first.contentId],
    );
    expect(
      publicationHistory.rows.map(
        (row: { revision_id: string }) => row.revision_id,
      ),
    ).toEqual([first.revisionId, second.revisionId]);
  });
});

function makeDocument(title: string) {
  return {
    schema_version: 1,
    title,
    description: 'A content platform foundation fixture.',
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
                  type: 'text',
                  text: 'Authored Git content remains canonical for this phase.',
                },
              ],
            },
          ],
        },
      },
    ],
  };
}
