import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { PoolClient, QueryResultRow } from 'pg';
import { DatabaseService } from '../../../../database/database.service';
import type {
  CreateContentArticle,
  CreateContentRevision,
  ContentListCursor,
  ContentListResult,
  ContentLifecycleRecord,
  ContentRevisionListResult,
  ContentRevisionRecord,
  ContentRevisionSummary,
  ContentImportState,
  ContentCatalogImportState,
  ContentCatalogSnapshotV1,
  PublishedContentRecord,
  StoredPublicContentCatalog,
  PublishContentRevision,
  TransitionContentStatus,
  ContentStatus,
  ContentArticleRouteAuditRow,
} from '../types/content-catalog.types';
import {
  ContentIdentityConflictError,
  ContentLifecycleConflictError,
  ContentLifecycleTransitionError,
  ContentItemNotFoundError,
  ContentRevisionConflictError,
  ContentRevisionNotFoundError,
  ContentSlugConflictError,
  ContentCatalogSnapshotConflictError,
} from '../types/content-catalog.types';

interface ContentRow extends QueryResultRow {
  id: string;
  content_key: string;
  content_type: 'article';
  slug: string;
  status: ContentStatus;
  latest_revision_id: string | null;
  published_revision_id: string | null;
  created_by: string | null;
  archived_at: Date | null;
  archived_by: string | null;
  created_at: Date;
  updated_at: Date;
}

interface RevisionRow extends QueryResultRow {
  id: string;
  content_item_id: string;
  revision_number: number;
  schema_version: 1;
  checksum_sha256: string;
  document: ContentRevisionRecord['document'];
  created_by: string | null;
  created_at: Date;
  published_at?: Date;
  published_by?: string | null;
}

interface ContentListRow extends ContentRow {
  cursor_created_at: string;
}

interface ContentRevisionSummaryRow extends QueryResultRow {
  content_item_id: string;
  id: string;
  revision_number: number;
  checksum_sha256: string;
  created_by: string | null;
  created_at: Date;
  published_at: Date | null;
  published_by: string | null;
}

interface ArticleRoutePreflightRow extends QueryResultRow {
  id: string;
  content_key: string;
  content_type: 'article';
  slug: string;
  status: ContentStatus;
  archived_at: Date | null;
  published_revision_id: string | null;
}

interface ContentImportStateRow extends QueryResultRow {
  id: string;
  content_key: string;
  slug: string;
  status: ContentStatus;
  latest_revision_id: string | null;
  published_revision_id: string | null;
  latest_revision_checksum_sha256: string | null;
}

interface CatalogSnapshotRow extends QueryResultRow {
  id: string;
  source_commit_sha: string;
  checksum_sha256: string;
  catalog: unknown;
  created_at: Date;
}

interface CatalogImportStateRow extends QueryResultRow {
  source_commit_sha: string;
  checksum_sha256: string;
  is_active: boolean;
}

interface PublishedCatalogContentRow extends QueryResultRow {
  content_id: string;
  content_key: string;
  slug: string;
  published_revision_id: string;
  title: string;
  description: string;
  published_at: Date;
}

@Injectable()
export class ContentCatalogRepository {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  async findGitContentCatalogImportState(
    sourceCommitSha: string,
  ): Promise<ContentCatalogImportState | null> {
    const result = await this.database.query<CatalogImportStateRow>(
      `SELECT snapshot.source_commit_sha, snapshot.checksum_sha256,
              (active.snapshot_id = snapshot.id) AS is_active
       FROM stack_atlas.content_catalog_snapshots AS snapshot
       LEFT JOIN stack_atlas.content_catalog_active_snapshot AS active
         ON active.slot = 1
       WHERE snapshot.source_commit_sha = $1`,
      [sourceCommitSha],
    );
    const row = result.rows[0];
    return row
      ? {
          sourceCommitSha: row.source_commit_sha,
          checksumSha256: row.checksum_sha256,
          isActive: row.is_active,
        }
      : null;
  }

  async storeGitContentCatalogSnapshot(input: {
    sourceCommitSha: string;
    checksumSha256: string;
    catalog: ContentCatalogSnapshotV1;
    actorAccountId: string;
  }): Promise<void> {
    await this.database.transaction(async (client) => {
      let snapshot = await client.query<CatalogSnapshotRow>(
        `SELECT id, source_commit_sha, checksum_sha256, catalog, created_at
         FROM stack_atlas.content_catalog_snapshots
         WHERE source_commit_sha = $1
         FOR SHARE`,
        [input.sourceCommitSha],
      );
      let row = snapshot.rows[0];
      if (row && row.checksum_sha256 !== input.checksumSha256) {
        throw new ContentCatalogSnapshotConflictError();
      }
      if (!row) {
        const id = randomUUID();
        const inserted = await client.query<CatalogSnapshotRow>(
          `INSERT INTO stack_atlas.content_catalog_snapshots
             (id, source_repository, source_commit_sha, checksum_sha256, catalog, created_by)
           VALUES ($1, 'tiecont/stack-atlas', $2, $3, $4::jsonb, $5)
           ON CONFLICT (source_commit_sha) DO NOTHING
           RETURNING id, source_commit_sha, checksum_sha256, catalog, created_at`,
          [
            id,
            input.sourceCommitSha,
            input.checksumSha256,
            JSON.stringify(input.catalog),
            input.actorAccountId,
          ],
        );
        row = inserted.rows[0];
        if (!row) {
          snapshot = await client.query<CatalogSnapshotRow>(
            `SELECT id, source_commit_sha, checksum_sha256, catalog, created_at
             FROM stack_atlas.content_catalog_snapshots
             WHERE source_commit_sha = $1
             FOR SHARE`,
            [input.sourceCommitSha],
          );
          row = snapshot.rows[0];
          if (!row || row.checksum_sha256 !== input.checksumSha256) {
            throw new ContentCatalogSnapshotConflictError();
          }
        }
      }

      if (!row)
        throw new Error('PostgreSQL did not return the catalog snapshot.');
      await client.query(
        `INSERT INTO stack_atlas.content_catalog_active_snapshot (slot, snapshot_id)
         VALUES (1, $1)
         ON CONFLICT (slot) DO UPDATE
         SET snapshot_id = EXCLUDED.snapshot_id, updated_at = now()
         WHERE stack_atlas.content_catalog_active_snapshot.snapshot_id
           IS DISTINCT FROM EXCLUDED.snapshot_id`,
        [row.id],
      );
    });
  }

  async findPublicContentCatalog(): Promise<StoredPublicContentCatalog | null> {
    return this.database.transaction(async (client) => {
      await client.query(
        'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY',
      );
      const active = await client.query<CatalogSnapshotRow>(
        `SELECT snapshot.id, snapshot.source_commit_sha, snapshot.checksum_sha256,
                snapshot.catalog, snapshot.created_at
         FROM stack_atlas.content_catalog_active_snapshot AS state
         JOIN stack_atlas.content_catalog_snapshots AS snapshot
           ON snapshot.id = state.snapshot_id
         WHERE state.slot = 1`,
      );
      const snapshot = active.rows[0];
      if (!snapshot) return null;
      const published = await client.query<PublishedCatalogContentRow>(
        `SELECT item.id AS content_id, item.content_key, item.slug,
                revision.id AS published_revision_id,
                revision.document->>'title' AS title,
                revision.document->>'description' AS description,
                publication.published_at
         FROM jsonb_array_elements($1::jsonb->'articles')
              WITH ORDINALITY AS source(metadata, position)
         JOIN stack_atlas.content_items AS item
           ON item.content_key = source.metadata->>'contentKey'
          AND item.status = 'PUBLISHED'
          AND item.archived_at IS NULL
         JOIN stack_atlas.content_revisions AS revision
           ON revision.id = item.published_revision_id
          AND revision.content_item_id = item.id
         JOIN LATERAL (
           SELECT published_at
           FROM stack_atlas.content_publications
           WHERE content_item_id = item.id AND revision_id = revision.id
           ORDER BY published_at DESC
           LIMIT 1
         ) AS publication ON true
         ORDER BY source.position`,
        [JSON.stringify(snapshot.catalog)],
      );
      return {
        sourceCommitSha: snapshot.source_commit_sha,
        checksumSha256: snapshot.checksum_sha256,
        createdAt: snapshot.created_at,
        catalog: snapshot.catalog,
        publishedArticles: published.rows.map((row) => ({
          contentId: row.content_id,
          contentKey: row.content_key,
          slug: row.slug,
          publishedRevisionId: row.published_revision_id,
          title: row.title,
          description: row.description,
          publishedAt: row.published_at,
        })),
      };
    });
  }

  async createArticle(
    input: CreateContentArticle,
  ): Promise<ContentRevisionRecord> {
    try {
      return await this.database.transaction(async (client) => {
        const contentId = randomUUID();
        const item = await client.query<ContentRow>(
          `INSERT INTO stack_atlas.content_items
             (id, content_key, content_type, slug, created_by)
           VALUES ($1, $2, 'article', $3, $4)
           RETURNING id, content_key, content_type, slug, status,
                     latest_revision_id, published_revision_id, created_by,
                     archived_at, archived_by, created_at, updated_at`,
          [contentId, input.contentKey, input.slug, input.actorAccountId],
        );
        const row = item.rows[0];
        if (!row)
          throw new Error(
            'PostgreSQL did not return the created content item.',
          );
        const revision = await this.insertRevision(client, {
          contentId,
          contentKey: row.content_key,
          slug: row.slug,
          status: row.status,
          createdBy: row.created_by,
          actorAccountId: input.actorAccountId,
          revisionNumber: 1,
          document: input.document,
          checksumSha256: input.checksumSha256,
        });
        const updatedItem = await client.query<ContentRow>(
          `UPDATE stack_atlas.content_items
           SET latest_revision_id = $2, updated_at = now()
           WHERE id = $1
           RETURNING id, content_key, content_type, slug, status,
                     latest_revision_id, published_revision_id, created_by,
                     archived_at, archived_by, created_at, updated_at`,
          [contentId, revision.revisionId],
        );
        if (!updatedItem.rows[0]) {
          throw new Error(
            'PostgreSQL did not return the updated content item.',
          );
        }
        return revision;
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        if (uniqueConstraint(error) === 'content_items_active_slug_unique') {
          throw new ContentSlugConflictError();
        }
        throw new ContentIdentityConflictError();
      }
      throw error;
    }
  }

  async createPublishedArticle(
    input: CreateContentArticle,
  ): Promise<PublishedContentRecord> {
    try {
      return await this.database.transaction(async (client) => {
        const contentId = randomUUID();
        const item = await client.query<ContentRow>(
          `INSERT INTO stack_atlas.content_items
             (id, content_key, content_type, slug, created_by)
           VALUES ($1, $2, 'article', $3, $4)
           RETURNING id, content_key, content_type, slug, status,
                     latest_revision_id, published_revision_id, created_by,
                     archived_at, archived_by, created_at, updated_at`,
          [contentId, input.contentKey, input.slug, input.actorAccountId],
        );
        const row = item.rows[0];
        if (!row)
          throw new Error(
            'PostgreSQL did not return the imported content item.',
          );

        const revision = await this.insertRevision(client, {
          contentId,
          contentKey: row.content_key,
          slug: row.slug,
          status: row.status,
          createdBy: row.created_by,
          actorAccountId: input.actorAccountId,
          revisionNumber: 1,
          document: input.document,
          checksumSha256: input.checksumSha256,
        });
        await client.query(
          `UPDATE stack_atlas.content_items
           SET latest_revision_id = $2, updated_at = now()
           WHERE id = $1`,
          [contentId, revision.revisionId],
        );
        const review = await client.query<{ id: string } & QueryResultRow>(
          `UPDATE stack_atlas.content_items
           SET status = 'IN_REVIEW', updated_at = now()
           WHERE id = $1 AND status = 'DRAFT'
           RETURNING id`,
          [contentId],
        );
        if (!review.rows[0]) throw new ContentLifecycleConflictError();

        const publication = await client.query<
          { published_at: Date; published_by: string } & QueryResultRow
        >(
          `INSERT INTO stack_atlas.content_publications
             (id, content_item_id, revision_id, published_at, published_by)
           VALUES ($1, $2, $3, now(), $4)
           RETURNING published_at, published_by`,
          [randomUUID(), contentId, revision.revisionId, input.actorAccountId],
        );
        const publishedAt = publication.rows[0]?.published_at;
        const publishedBy = publication.rows[0]?.published_by;
        if (!publishedAt || !publishedBy) {
          throw new Error(
            'PostgreSQL did not return imported publication metadata.',
          );
        }

        const published = await client.query<{ id: string } & QueryResultRow>(
          `UPDATE stack_atlas.content_items
           SET status = 'PUBLISHED', published_revision_id = $2, updated_at = now()
           WHERE id = $1 AND status = 'IN_REVIEW'
           RETURNING id`,
          [contentId, revision.revisionId],
        );
        if (!published.rows[0]) throw new ContentLifecycleConflictError();
        return {
          ...revision,
          status: 'PUBLISHED',
          publishedAt,
          publishedBy,
        };
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        if (uniqueConstraint(error) === 'content_items_active_slug_unique') {
          throw new ContentSlugConflictError();
        }
        throw new ContentIdentityConflictError();
      }
      throw error;
    }
  }

  async findImportStateByKey(
    contentKey: string,
  ): Promise<ContentImportState | null> {
    const result = await this.database.query<ContentImportStateRow>(
      `SELECT item.id, item.content_key, item.slug, item.status,
              item.latest_revision_id, item.published_revision_id,
              revision.checksum_sha256 AS latest_revision_checksum_sha256
       FROM stack_atlas.content_items AS item
       LEFT JOIN stack_atlas.content_revisions AS revision
         ON revision.id = item.latest_revision_id
        AND revision.content_item_id = item.id
       WHERE item.content_key = $1`,
      [contentKey],
    );
    const row = result.rows[0];
    if (!row) return null;
    return mapContentImportState(row);
  }

  async findImportStateBySlug(
    slug: string,
  ): Promise<ContentImportState | null> {
    const result = await this.database.query<ContentImportStateRow>(
      `SELECT item.id, item.content_key, item.slug, item.status,
              item.latest_revision_id, item.published_revision_id,
              revision.checksum_sha256 AS latest_revision_checksum_sha256
       FROM stack_atlas.content_items AS item
       LEFT JOIN stack_atlas.content_revisions AS revision
         ON revision.id = item.latest_revision_id
        AND revision.content_item_id = item.id
       WHERE item.slug = $1 AND item.archived_at IS NULL`,
      [slug],
    );
    const row = result.rows[0];
    return row ? mapContentImportState(row) : null;
  }

  appendRevision(input: CreateContentRevision): Promise<ContentRevisionRecord> {
    return this.database.transaction(async (client) => {
      const item = await this.lockContentItem(client, input.contentId);
      if (item.status !== 'DRAFT') {
        throw new ContentLifecycleTransitionError();
      }
      if (item.latest_revision_id !== input.baseRevisionId) {
        throw new ContentRevisionConflictError();
      }
      const current = await client.query<
        { revision_number: number } & QueryResultRow
      >(
        `SELECT revision_number
         FROM stack_atlas.content_revisions
         WHERE id = $1 AND content_item_id = $2`,
        [item.latest_revision_id, input.contentId],
      );
      const latestRevisionNumber = current.rows[0]?.revision_number;
      if (latestRevisionNumber === undefined) {
        throw new Error(
          'Content item does not have its required latest revision.',
        );
      }
      const revision = await this.insertRevision(client, {
        contentId: item.id,
        contentKey: item.content_key,
        slug: item.slug,
        status: item.status,
        createdBy: item.created_by,
        actorAccountId: input.actorAccountId,
        revisionNumber: latestRevisionNumber + 1,
        document: input.document,
        checksumSha256: input.checksumSha256,
      });
      await client.query(
        `UPDATE stack_atlas.content_items
         SET latest_revision_id = $2, updated_at = now()
         WHERE id = $1`,
        [input.contentId, revision.revisionId],
      );
      return revision;
    });
  }

  async findRevision(
    contentId: string,
    revisionId: string,
  ): Promise<ContentRevisionRecord | null> {
    const result = await this.database.query<
      (RevisionRow & {
        content_item_id: string;
        content_key: string;
        content_type: 'article';
        slug: string;
        status: ContentStatus;
        item_created_by: string | null;
      }) &
        QueryResultRow
    >(
      `SELECT item.id AS content_item_id, item.content_key, item.content_type,
              item.slug, item.status, item.created_by AS item_created_by,
              revision.id, revision.content_item_id, revision.revision_number,
              revision.schema_version, revision.checksum_sha256, revision.document,
              revision.created_by, revision.created_at,
              publication.published_at, publication.published_by
       FROM stack_atlas.content_items AS item
       JOIN stack_atlas.content_revisions AS revision
         ON revision.content_item_id = item.id
       LEFT JOIN LATERAL (
         SELECT published_at, published_by
         FROM stack_atlas.content_publications
         WHERE revision_id = revision.id
         ORDER BY published_at DESC
         LIMIT 1
       ) AS publication ON true
       WHERE item.id = $1 AND revision.id = $2`,
      [contentId, revisionId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return mapRevision(
      {
        id: row.content_item_id,
        content_key: row.content_key,
        content_type: row.content_type,
        slug: row.slug,
        status: row.status,
        created_by: row.item_created_by,
      },
      row,
    );
  }

  async listContent(input: {
    limit: number;
    status?: ContentStatus;
    before?: ContentListCursor;
  }): Promise<ContentListResult> {
    const values: (string | number)[] = [];
    const conditions: string[] = [];
    const bind = (value: string | number): string => {
      values.push(value);
      return `$${values.length}`;
    };
    if (input.status) conditions.push(`status = ${bind(input.status)}`);
    if (input.before) {
      const createdAt = bind(input.before.createdAt);
      const contentId = bind(input.before.contentId);
      conditions.push(
        `(created_at, id) < (${createdAt}::timestamptz, ${contentId}::uuid)`,
      );
    }
    const limit = bind(input.limit + 1);
    const result = await this.database.query<ContentListRow>(
      `SELECT id, content_key, content_type, slug, status,
              latest_revision_id, published_revision_id, created_by,
              archived_at, archived_by, created_at, updated_at,
              created_at::text AS cursor_created_at
       FROM stack_atlas.content_items
       ${conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''}
       ORDER BY created_at DESC, id DESC
       LIMIT ${limit}`,
      values,
    );
    const hasMore = result.rows.length > input.limit;
    const items = result.rows.slice(0, input.limit);
    const last = items.at(-1);
    return {
      items: items.map(mapLifecycle),
      hasMore,
      nextCursor:
        hasMore && last
          ? { createdAt: last.cursor_created_at, contentId: last.id }
          : null,
    };
  }

  async listArticleRoutePreflightRows(): Promise<
    ContentArticleRouteAuditRow[]
  > {
    return this.database.transaction(async (client) => {
      await client.query('SET TRANSACTION READ ONLY');
      const result = await client.query<ArticleRoutePreflightRow>(
        "SELECT id, content_key, content_type, slug, status, archived_at, published_revision_id FROM stack_atlas.content_items WHERE content_type = 'article' ORDER BY id",
      );
      return result.rows.map((row) => ({
        contentId: row.id,
        contentKey: row.content_key,
        contentType: row.content_type,
        slug: row.slug,
        status: row.status,
        archivedAt: row.archived_at,
        publishedRevisionId: row.published_revision_id,
      }));
    });
  }

  async listRevisions(
    contentId: string,
    limit: number,
    beforeRevisionNumber?: number,
  ): Promise<ContentRevisionListResult> {
    const beforeClause =
      beforeRevisionNumber === undefined
        ? ''
        : 'AND revision.revision_number < $3';
    const values =
      beforeRevisionNumber === undefined
        ? [contentId, limit + 1]
        : [contentId, limit + 1, beforeRevisionNumber];
    const result = await this.database.query<ContentRevisionSummaryRow>(
      `SELECT revision.content_item_id, revision.id, revision.revision_number,
              revision.checksum_sha256, revision.created_by, revision.created_at,
              publication.published_at, publication.published_by
       FROM stack_atlas.content_revisions AS revision
       LEFT JOIN LATERAL (
         SELECT published_at, published_by
         FROM stack_atlas.content_publications
         WHERE revision_id = revision.id
         ORDER BY published_at DESC
         LIMIT 1
       ) AS publication ON true
       WHERE revision.content_item_id = $1 ${beforeClause}
       ORDER BY revision.revision_number DESC
       LIMIT $2`,
      values,
    );
    const hasMore = result.rows.length > limit;
    const items = result.rows.slice(0, limit);
    const last = items.at(-1);
    return {
      items: items.map(mapRevisionSummary),
      hasMore,
      nextCursor: hasMore && last ? last.revision_number : null,
    };
  }

  publishRevision(
    input: PublishContentRevision,
  ): Promise<PublishedContentRecord> {
    return this.database.transaction(async (client) => {
      const item = await this.lockContentItem(client, input.contentId);
      if (item.status !== input.expectedStatus) {
        throw new ContentLifecycleConflictError();
      }
      if (item.status !== 'IN_REVIEW') {
        throw new ContentLifecycleTransitionError();
      }
      const revision = await client.query<RevisionRow>(
        `SELECT id, content_item_id, revision_number, schema_version,
                checksum_sha256, document, created_by, created_at
         FROM stack_atlas.content_revisions
         WHERE id = $1 AND content_item_id = $2`,
        [input.revisionId, item.id],
      );
      const row = revision.rows[0];
      if (!row) throw new ContentRevisionNotFoundError();

      const publication = await client.query<
        { published_at: Date; published_by: string } & QueryResultRow
      >(
        `INSERT INTO stack_atlas.content_publications
           (id, content_item_id, revision_id, published_at, published_by)
         VALUES ($1, $2, $3, now(), $4)
         RETURNING published_at, published_by`,
        [randomUUID(), item.id, row.id, input.actorAccountId],
      );
      const publishedAt = publication.rows[0]?.published_at;
      const publishedBy = publication.rows[0]?.published_by;
      if (!publishedAt)
        throw new Error('PostgreSQL did not return the publication timestamp.');
      if (!publishedBy)
        throw new Error('PostgreSQL did not return the publication actor.');
      const updatedItem = await client.query<ContentRow>(
        `UPDATE stack_atlas.content_items
         SET published_revision_id = $2, status = 'PUBLISHED', updated_at = now()
         WHERE id = $1 AND status = 'IN_REVIEW'
         RETURNING id, content_key, content_type, slug, status,
                   latest_revision_id, published_revision_id, created_by,
                   archived_at, archived_by, created_at, updated_at`,
        [item.id, row.id],
      );
      const publishedItem = updatedItem.rows[0];
      if (!publishedItem) throw new ContentLifecycleConflictError();
      return { ...mapRevision(publishedItem, row), publishedAt, publishedBy };
    });
  }

  async findPublishedByKey(
    contentKey: string,
  ): Promise<PublishedContentRecord | null> {
    return this.findPublishedByIdentity('content_key', contentKey);
  }

  async findPublishedBySlug(
    slug: string,
  ): Promise<PublishedContentRecord | null> {
    return this.findPublishedByIdentity('slug', slug);
  }

  async searchPublishedContent(
    query: string,
    limit: number,
  ): Promise<PublishedContentRecord[]> {
    const result = await this.database.query<
      (RevisionRow & {
        content_id: string;
        content_key: string;
        content_type: 'article';
        slug: string;
        status: ContentStatus;
        item_created_by: string | null;
      }) &
        QueryResultRow
    >(
      `SELECT item.id AS content_id, item.content_key, item.content_type,
              item.slug, item.status, item.created_by AS item_created_by,
              revision.id, revision.content_item_id, revision.revision_number,
              revision.schema_version, revision.checksum_sha256, revision.document,
              revision.created_by, revision.created_at,
              publication.published_at, publication.published_by
       FROM stack_atlas.content_items AS item
       JOIN stack_atlas.content_revisions AS revision
         ON revision.id = item.published_revision_id
        AND revision.content_item_id = item.id
       JOIN LATERAL (
         SELECT published_at, published_by
         FROM stack_atlas.content_publications
         WHERE content_item_id = item.id AND revision_id = revision.id
         ORDER BY published_at DESC
         LIMIT 1
       ) AS publication ON true
       CROSS JOIN LATERAL (
         SELECT concat_ws(
           ' ',
           item.slug,
           revision.document->>'title',
           revision.document->>'description',
           jsonb_path_query_array(revision.document, '$.blocks[*].props.**.text')::text,
           jsonb_path_query_array(revision.document, '$.blocks[*].props.**.code')::text,
           jsonb_path_query_array(revision.document, '$.blocks[*].props.**.language')::text,
           jsonb_path_query_array(revision.document, '$.blocks[*].props.**.title')::text,
           jsonb_path_query_array(revision.document, '$.blocks[*].props.**.description')::text,
           jsonb_path_query_array(revision.document, '$.blocks[*].props.**.caption')::text,
           jsonb_path_query_array(revision.document, '$.blocks[*].props.**.alt')::text,
           jsonb_path_query_array(revision.document, '$.blocks[*].props.**.headers')::text,
           jsonb_path_query_array(revision.document, '$.blocks[*].props.**.rows')::text
         ) AS searchable_text
       ) AS search
       WHERE item.status = 'PUBLISHED'
         AND item.archived_at IS NULL
         AND position(lower($1) in lower(search.searchable_text)) > 0
       ORDER BY
         CASE
           WHEN lower(revision.document->>'title') = lower($1) THEN 0
           WHEN position(lower($1) in lower(revision.document->>'title')) > 0 THEN 1
           ELSE 2
         END,
         publication.published_at DESC,
         item.content_key ASC
       LIMIT $2`,
      [query, limit],
    );

    return result.rows.map((row) => ({
      ...mapRevision(
        {
          id: row.content_id,
          content_key: row.content_key,
          content_type: row.content_type,
          slug: row.slug,
          status: row.status,
          created_by: row.item_created_by,
        },
        row,
      ),
      publishedAt: row.published_at ?? row.created_at,
      publishedBy: row.published_by ?? null,
    }));
  }

  private async findPublishedByIdentity(
    identityColumn: 'content_key' | 'slug',
    identity: string,
  ): Promise<PublishedContentRecord | null> {
    const result = await this.database.query<
      (RevisionRow & {
        content_id: string;
        content_key: string;
        content_type: 'article';
        slug: string;
        status: ContentStatus;
        item_created_by: string | null;
      }) &
        QueryResultRow
    >(
      `SELECT item.id AS content_id, item.content_key, item.content_type,
              item.slug, item.status, item.created_by AS item_created_by,
              revision.id, revision.content_item_id, revision.revision_number,
              revision.schema_version, revision.checksum_sha256, revision.document,
              revision.created_by, revision.created_at,
              publication.published_at, publication.published_by
       FROM stack_atlas.content_items AS item
       JOIN stack_atlas.content_revisions AS revision
         ON revision.id = item.published_revision_id
        AND revision.content_item_id = item.id
       JOIN LATERAL (
         SELECT published_at, published_by
         FROM stack_atlas.content_publications
         WHERE content_item_id = item.id AND revision_id = revision.id
         ORDER BY published_at DESC
         LIMIT 1
       ) AS publication ON true
       WHERE item.${identityColumn} = $1
         AND item.status = 'PUBLISHED'
         AND item.archived_at IS NULL`,
      [identity],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      ...mapRevision(
        {
          id: row.content_id,
          content_key: row.content_key,
          content_type: row.content_type,
          slug: row.slug,
          status: row.status,
          created_by: row.item_created_by,
        },
        row,
      ),
      publishedAt: row.published_at ?? row.created_at,
      publishedBy: row.published_by ?? null,
    };
  }

  async findLifecycle(
    contentId: string,
  ): Promise<ContentLifecycleRecord | null> {
    const result = await this.database.query<ContentRow>(
      `SELECT id, content_key, content_type, slug, status,
              latest_revision_id, published_revision_id, created_by,
              archived_at, archived_by, created_at, updated_at
       FROM stack_atlas.content_items
       WHERE id = $1`,
      [contentId],
    );
    const item = result.rows[0];
    return item ? mapLifecycle(item) : null;
  }

  async transitionStatus(
    input: TransitionContentStatus,
  ): Promise<ContentLifecycleRecord> {
    try {
      return await this.database.transaction(async (client) => {
        const item = await this.lockContentItem(client, input.contentId);
        if (item.status !== input.expectedStatus) {
          throw new ContentLifecycleConflictError();
        }
        if (input.nextStatus === 'PUBLISHED') {
          throw new ContentLifecycleTransitionError();
        }
        const result = await client.query<ContentRow>(
          `UPDATE stack_atlas.content_items
           SET status = $2,
               archived_at = CASE WHEN $2 = 'ARCHIVED' THEN now() ELSE NULL END,
               archived_by = CASE WHEN $2 = 'ARCHIVED' THEN $3::uuid ELSE NULL END,
               updated_at = now()
           WHERE id = $1 AND status = $4
           RETURNING id, content_key, content_type, slug, status,
                     latest_revision_id, published_revision_id, created_by,
                     archived_at, archived_by, created_at, updated_at`,
          [
            input.contentId,
            input.nextStatus,
            input.actorAccountId,
            input.expectedStatus,
          ],
        );
        const updated = result.rows[0];
        if (!updated) throw new ContentLifecycleConflictError();
        return mapLifecycle(updated);
      });
    } catch (error) {
      if (
        isUniqueViolation(error) &&
        uniqueConstraint(error) === 'content_items_active_slug_unique'
      ) {
        throw new ContentSlugConflictError();
      }
      throw error;
    }
  }

  private async lockContentItem(
    client: PoolClient,
    contentId: string,
  ): Promise<ContentRow> {
    const result = await client.query<ContentRow>(
      `SELECT id, content_key, content_type, slug, status,
              latest_revision_id, published_revision_id, created_by,
              archived_at, archived_by, created_at, updated_at
       FROM stack_atlas.content_items
       WHERE id = $1
       FOR UPDATE`,
      [contentId],
    );
    const item = result.rows[0];
    if (!item) throw new ContentItemNotFoundError();
    return item;
  }

  private async insertRevision(
    client: PoolClient,
    input: {
      contentId: string;
      contentKey: string;
      slug: string;
      status: ContentStatus;
      createdBy: string | null;
      actorAccountId: string;
      revisionNumber: number;
      document: ContentRevisionRecord['document'];
      checksumSha256: string;
    },
  ): Promise<ContentRevisionRecord> {
    const revisionId = randomUUID();
    const result = await client.query<RevisionRow>(
      `INSERT INTO stack_atlas.content_revisions
         (id, content_item_id, revision_number, schema_version, document,
          checksum_sha256, created_by)
       VALUES ($1, $2, $3, 1, $4::jsonb, $5, $6)
       RETURNING id, content_item_id, revision_number, schema_version,
                 checksum_sha256, document, created_by, created_at`,
      [
        revisionId,
        input.contentId,
        input.revisionNumber,
        JSON.stringify(input.document),
        input.checksumSha256,
        input.actorAccountId,
      ],
    );
    const row = result.rows[0];
    if (!row)
      throw new Error(
        'PostgreSQL did not return the created content revision.',
      );
    return mapRevision(
      {
        id: input.contentId,
        content_key: input.contentKey,
        content_type: 'article',
        slug: input.slug,
        status: input.status,
        created_by: input.createdBy,
      },
      row,
    );
  }
}

function mapRevision(
  item: Pick<
    ContentRow,
    'id' | 'content_key' | 'content_type' | 'slug' | 'status' | 'created_by'
  >,
  revision: RevisionRow,
): ContentRevisionRecord {
  return {
    contentId: item.id,
    contentKey: item.content_key,
    slug: item.slug,
    status: item.status,
    contentType: item.content_type,
    createdBy: item.created_by,
    revisionCreatedBy: revision.created_by,
    revisionId: revision.id,
    revisionNumber: revision.revision_number,
    schemaVersion: 1,
    checksumSha256: revision.checksum_sha256,
    document: revision.document,
    createdAt: revision.created_at,
    ...(revision.published_at !== undefined
      ? { publishedAt: revision.published_at }
      : {}),
    ...(revision.published_by !== undefined
      ? { publishedBy: revision.published_by }
      : {}),
  };
}

function mapLifecycle(item: ContentRow): ContentLifecycleRecord {
  return {
    contentId: item.id,
    contentKey: item.content_key,
    contentType: item.content_type,
    slug: item.slug,
    status: item.status,
    latestRevisionId: item.latest_revision_id,
    publishedRevisionId: item.published_revision_id,
    createdBy: item.created_by,
    archivedAt: item.archived_at,
    archivedBy: item.archived_by,
    createdAt: item.created_at,
    updatedAt: item.updated_at,
  };
}

function mapContentImportState(row: ContentImportStateRow): ContentImportState {
  return {
    contentId: row.id,
    contentKey: row.content_key,
    slug: row.slug,
    status: row.status,
    latestRevisionId: row.latest_revision_id,
    publishedRevisionId: row.published_revision_id,
    latestRevisionChecksumSha256: row.latest_revision_checksum_sha256,
  };
}

function mapRevisionSummary(
  revision: ContentRevisionSummaryRow,
): ContentRevisionSummary {
  return {
    contentId: revision.content_item_id,
    revisionId: revision.id,
    revisionNumber: revision.revision_number,
    checksumSha256: revision.checksum_sha256,
    revisionCreatedBy: revision.created_by,
    createdAt: revision.created_at,
    publishedAt: revision.published_at,
    publishedBy: revision.published_by,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === '23505'
  );
}

function uniqueConstraint(error: unknown): string | null {
  return typeof error === 'object' &&
    error !== null &&
    'constraint' in error &&
    typeof error.constraint === 'string'
    ? error.constraint
    : null;
}
