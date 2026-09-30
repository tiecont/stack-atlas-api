import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { PoolClient, QueryResultRow } from 'pg';
import { DatabaseService } from '../../../../database/database.service';
import type {
  CreateContentArticle,
  CreateContentRevision,
  ContentRevisionRecord,
  PublishedContentRecord,
  PublishContentRevision,
} from '../types/content-catalog.types';
import {
  ContentIdentityConflictError,
  ContentItemNotFoundError,
  ContentRevisionNotFoundError,
} from '../types/content-catalog.types';

interface ContentRow extends QueryResultRow {
  id: string;
  content_key: string;
  content_type: 'article';
  latest_revision_id: string | null;
  published_revision_id: string | null;
}

interface RevisionRow extends QueryResultRow {
  id: string;
  content_item_id: string;
  revision_number: number;
  schema_version: 1;
  checksum_sha256: string;
  document: ContentRevisionRecord['document'];
  created_at: Date;
  published_at?: Date;
}

@Injectable()
export class ContentCatalogRepository {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  async createArticle(
    input: CreateContentArticle,
  ): Promise<ContentRevisionRecord> {
    try {
      return await this.database.transaction(async (client) => {
        const contentId = randomUUID();
        const item = await client.query<ContentRow>(
          `INSERT INTO stack_atlas.content_items (id, content_key, content_type)
           VALUES ($1, $2, 'article')
           RETURNING id, content_key, content_type, latest_revision_id, published_revision_id`,
          [contentId, input.contentKey],
        );
        const row = item.rows[0];
        if (!row)
          throw new Error(
            'PostgreSQL did not return the created content item.',
          );
        const revision = await this.insertRevision(client, {
          contentId,
          contentKey: row.content_key,
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
        return revision;
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new ContentIdentityConflictError();
      throw error;
    }
  }

  appendRevision(input: CreateContentRevision): Promise<ContentRevisionRecord> {
    return this.database.transaction(async (client) => {
      const item = await this.lockContentItem(client, input.contentId);
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
      }) &
        QueryResultRow
    >(
      `SELECT item.id AS content_item_id, item.content_key, item.content_type,
              revision.id, revision.content_item_id, revision.revision_number,
              revision.schema_version, revision.checksum_sha256, revision.document,
              revision.created_at
       FROM stack_atlas.content_items AS item
       JOIN stack_atlas.content_revisions AS revision
         ON revision.content_item_id = item.id
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
        latest_revision_id: null,
        published_revision_id: null,
      },
      row,
    );
  }

  publishRevision(
    input: PublishContentRevision,
  ): Promise<PublishedContentRecord> {
    return this.database.transaction(async (client) => {
      const item = await this.lockContentItem(client, input.contentId);
      const revision = await client.query<RevisionRow>(
        `SELECT id, content_item_id, revision_number, schema_version,
                checksum_sha256, document, created_at
         FROM stack_atlas.content_revisions
         WHERE id = $1 AND content_item_id = $2`,
        [input.revisionId, item.id],
      );
      const row = revision.rows[0];
      if (!row) throw new ContentRevisionNotFoundError();

      const publication = await client.query<
        { published_at: Date } & QueryResultRow
      >(
        `INSERT INTO stack_atlas.content_publications (id, content_item_id, revision_id, published_at)
         VALUES ($1, $2, $3, now())
         RETURNING published_at`,
        [randomUUID(), item.id, row.id],
      );
      const publishedAt = publication.rows[0]?.published_at;
      if (!publishedAt)
        throw new Error('PostgreSQL did not return the publication timestamp.');
      await client.query(
        `UPDATE stack_atlas.content_items
         SET published_revision_id = $2, updated_at = now()
         WHERE id = $1`,
        [item.id, row.id],
      );
      return { ...mapRevision(item, row), publishedAt };
    });
  }

  async findPublishedByKey(
    contentKey: string,
  ): Promise<PublishedContentRecord | null> {
    const result = await this.database.query<
      (RevisionRow & {
        content_id: string;
        content_key: string;
        content_type: 'article';
      }) &
        QueryResultRow
    >(
      `SELECT item.id AS content_id, item.content_key, item.content_type,
              revision.id, revision.content_item_id, revision.revision_number,
              revision.schema_version, revision.checksum_sha256, revision.document,
              revision.created_at, publication.published_at
       FROM stack_atlas.content_items AS item
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
       WHERE item.content_key = $1`,
      [contentKey],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      ...mapRevision(
        {
          id: row.content_id,
          content_key: row.content_key,
          content_type: row.content_type,
          latest_revision_id: null,
          published_revision_id: row.id,
        },
        row,
      ),
      publishedAt: row.published_at ?? row.created_at,
    };
  }

  private async lockContentItem(
    client: PoolClient,
    contentId: string,
  ): Promise<ContentRow> {
    const result = await client.query<ContentRow>(
      `SELECT id, content_key, content_type, latest_revision_id, published_revision_id
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
      revisionNumber: number;
      document: ContentRevisionRecord['document'];
      checksumSha256: string;
    },
  ): Promise<ContentRevisionRecord> {
    const revisionId = randomUUID();
    const result = await client.query<RevisionRow>(
      `INSERT INTO stack_atlas.content_revisions
         (id, content_item_id, revision_number, schema_version, document, checksum_sha256)
       VALUES ($1, $2, $3, 1, $4::jsonb, $5)
       RETURNING id, content_item_id, revision_number, schema_version,
                 checksum_sha256, document, created_at`,
      [
        revisionId,
        input.contentId,
        input.revisionNumber,
        JSON.stringify(input.document),
        input.checksumSha256,
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
        latest_revision_id: null,
        published_revision_id: null,
      },
      row,
    );
  }
}

function mapRevision(
  item: ContentRow,
  revision: RevisionRow,
): ContentRevisionRecord {
  return {
    contentId: item.id,
    contentKey: item.content_key,
    contentType: item.content_type,
    revisionId: revision.id,
    revisionNumber: revision.revision_number,
    schemaVersion: 1,
    checksumSha256: revision.checksum_sha256,
    document: revision.document,
    createdAt: revision.created_at,
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
