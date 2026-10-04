import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { CONTENT_STATUS } from '../types/content-catalog.types';
import type { ContentStatus } from '../types/content-catalog.types';
import { CANONICAL_ARTICLE_SLUG_PATTERN } from '../types/content-slug';

const MAX_PAGE_SIZE = 100;
const ADMIN_CONTENT_SLUG_DESCRIPTION =
  'Persisted article route identity. New writes are canonical; historical rows may remain non-canonical until A01.2 remediation.';

export class ListContentQueryDto {
  @ApiPropertyOptional({ default: 50, minimum: 1, maximum: MAX_PAGE_SIZE })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  limit = 50;

  @ApiPropertyOptional({ maxLength: 512 })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  cursor?: string;

  @ApiPropertyOptional({ enum: Object.values(CONTENT_STATUS) })
  @IsOptional()
  @IsIn(Object.values(CONTENT_STATUS))
  status?: ContentStatus;
}

export class ListRevisionsQueryDto {
  @ApiPropertyOptional({ default: 50, minimum: 1, maximum: MAX_PAGE_SIZE })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  limit = 50;

  @ApiPropertyOptional({ maxLength: 9, pattern: '^[1-9][0-9]{0,8}$' })
  @IsOptional()
  @IsString()
  @MaxLength(9)
  cursor?: string;
}

export class CreateContentDto {
  @ApiProperty({ maxLength: 255, example: 'article:transactional-outbox' })
  @IsString()
  @MaxLength(255)
  contentKey!: string;

  @ApiProperty({
    maxLength: 1024,
    example: 'articles/architecture/transactional-outbox',
    description:
      'Article route normalized and stored as articles/<domain>/<slug>; both segments use lowercase ASCII letters, digits, and single hyphens.',
  })
  @IsString()
  @MaxLength(1024)
  slug!: string;

  @ApiProperty({ type: () => ContentDocumentResponseDto })
  @IsObject()
  document!: Record<string, unknown>;
}

export class CreateContentRevisionDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  baseRevisionId!: string;

  @ApiProperty({ type: () => ContentDocumentResponseDto })
  @IsObject()
  document!: Record<string, unknown>;
}

export class PublishContentRevisionDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  revisionId!: string;
}

export class ContentDocumentResponseDto {
  @ApiProperty({ enum: [1] })
  schema_version!: 1;

  @ApiProperty({ maxLength: 160 })
  title!: string;

  @ApiProperty({ maxLength: 500 })
  description!: string;

  @ApiProperty({
    type: 'array',
    items: {
      type: 'object',
      required: ['id', 'type', 'version', 'props'],
      properties: {
        id: { type: 'string' },
        type: {
          type: 'string',
          enum: [
            'rich_text',
            'heading',
            'code',
            'callout',
            'image',
            'table',
            'divider',
            'related_content',
          ],
        },
        version: { type: 'integer', enum: [1] },
        props: { type: 'object', additionalProperties: true },
      },
    },
  })
  blocks!: Record<string, unknown>[];
}

export class ContentItemResponseDto {
  @ApiProperty({ format: 'uuid' })
  contentId!: string;

  @ApiProperty({ maxLength: 255 })
  contentKey!: string;

  @ApiProperty({
    maxLength: 255,
    example: 'articles/architecture/transactional-outbox',
    description: ADMIN_CONTENT_SLUG_DESCRIPTION,
  })
  slug!: string;

  @ApiProperty({ enum: Object.values(CONTENT_STATUS) })
  status!: ContentStatus;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  latestRevisionId!: string | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  publishedRevisionId!: string | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  createdBy!: string | null;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  archivedAt!: string | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  archivedBy!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class ContentRevisionSummaryResponseDto {
  @ApiProperty({ format: 'uuid' })
  contentId!: string;

  @ApiProperty({ format: 'uuid' })
  revisionId!: string;

  @ApiProperty({ minimum: 1 })
  revisionNumber!: number;

  @ApiProperty({ pattern: '^[a-f0-9]{64}$' })
  checksumSha256!: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  revisionCreatedBy!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  publishedAt!: string | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  publishedBy!: string | null;
}

export class ContentRevisionResponseDto {
  @ApiProperty({ format: 'uuid' })
  contentId!: string;

  @ApiProperty({ maxLength: 255 })
  contentKey!: string;

  @ApiProperty({
    maxLength: 255,
    example: 'articles/architecture/transactional-outbox',
    description: ADMIN_CONTENT_SLUG_DESCRIPTION,
  })
  slug!: string;

  @ApiProperty({ enum: Object.values(CONTENT_STATUS) })
  status!: ContentStatus;

  @ApiProperty({ enum: ['article'] })
  contentType!: 'article';

  @ApiProperty({ format: 'uuid' })
  revisionId!: string;

  @ApiProperty({ minimum: 1 })
  revisionNumber!: number;

  @ApiProperty({ pattern: '^[a-f0-9]{64}$' })
  checksumSha256!: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  revisionCreatedBy!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  publishedAt!: string | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  publishedBy!: string | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  createdBy!: string | null;

  @ApiProperty({ type: ContentDocumentResponseDto })
  document!: ContentDocumentResponseDto;
}

export class PublishedContentResponseDto extends ContentRevisionResponseDto {
  @ApiProperty({ format: 'date-time' })
  declare publishedAt: string;

  @ApiProperty({ format: 'uuid' })
  declare publishedBy: string;
}

export class ContentListResponseDto {
  @ApiProperty({ type: [ContentItemResponseDto] })
  items!: ContentItemResponseDto[];

  @ApiPropertyOptional({ nullable: true, maxLength: 512 })
  nextCursor!: string | null;
}

export class ContentRevisionListResponseDto {
  @ApiProperty({ type: [ContentRevisionSummaryResponseDto] })
  items!: ContentRevisionSummaryResponseDto[];

  @ApiPropertyOptional({ nullable: true, maxLength: 9 })
  nextCursor!: string | null;
}

export class PublicContentSearchItemResponseDto {
  @ApiProperty({ format: 'uuid' })
  contentId!: string;

  @ApiProperty({ maxLength: 255 })
  contentKey!: string;

  @ApiProperty({ enum: ['article'] })
  contentType!: 'article';

  @ApiProperty({
    maxLength: 255,
    pattern: CANONICAL_ARTICLE_SLUG_PATTERN,
    example: 'articles/architecture/transactional-outbox',
  })
  slug!: string;

  @ApiProperty({ format: 'uuid' })
  publishedRevisionId!: string;

  @ApiProperty({ maxLength: 160 })
  title!: string;

  @ApiProperty({ maxLength: 500 })
  description!: string;

  @ApiProperty({ format: 'date-time' })
  publishedAt!: string;
}

export class PublicContentSearchResponseDto {
  @ApiProperty({ type: [PublicContentSearchItemResponseDto], maxItems: 20 })
  items!: PublicContentSearchItemResponseDto[];
}

export class PublicCatalogSiteResponseDto {
  @ApiProperty({ maxLength: 160 })
  name!: string;

  @ApiProperty({ maxLength: 500 })
  description!: string;

  @ApiProperty({ maxLength: 32 })
  language!: string;
}

export class PublicCatalogTopicResponseDto {
  @ApiProperty({ maxLength: 128 })
  id!: string;

  @ApiProperty({ maxLength: 160 })
  title!: string;

  @ApiProperty({ maxLength: 2000 })
  description!: string;

  @ApiPropertyOptional({ maxLength: 32 })
  status?: string;

  @ApiPropertyOptional({ maxLength: 80 })
  icon?: string;
}

export class PublicCatalogCategoryResponseDto {
  @ApiProperty({ maxLength: 128 })
  id!: string;

  @ApiProperty({ maxLength: 160 })
  title!: string;
}

export class PublicCatalogPathModuleResponseDto {
  @ApiProperty({ maxLength: 128 })
  id!: string;

  @ApiProperty({ maxLength: 160 })
  title!: string;

  @ApiProperty({ minimum: 1 })
  order!: number;

  @ApiProperty({ maxLength: 128 })
  domain!: string;

  @ApiProperty({ maxLength: 128 })
  category!: string;

  @ApiPropertyOptional({ maxLength: 160 })
  group?: string;

  @ApiProperty({ type: [String], maxItems: 500 })
  articleIds!: string[];

  @ApiProperty({ type: [String], maxItems: 100 })
  legacyIndexUrls!: string[];
}

export class PublicCatalogPathResponseDto {
  @ApiProperty({ maxLength: 128 })
  id!: string;

  @ApiProperty({ maxLength: 160 })
  title!: string;

  @ApiProperty({ maxLength: 2000 })
  description!: string;

  @ApiPropertyOptional({ maxLength: 32 })
  status?: string;

  @ApiPropertyOptional({ maxLength: 128 })
  domain?: string;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: { type: 'string' },
  })
  difficulty?: { start: string; end: string };

  @ApiProperty({ type: [String], maxItems: 100 })
  legacyIndexUrls!: string[];

  @ApiProperty({ type: [PublicCatalogPathModuleResponseDto], maxItems: 500 })
  modules!: PublicCatalogPathModuleResponseDto[];
}

export class PublicCatalogArticleResponseDto {
  @ApiProperty({ maxLength: 128 })
  sourceId!: string;

  @ApiProperty({ maxLength: 255 })
  contentKey!: string;

  @ApiProperty({ maxLength: 128 })
  domain!: string;

  @ApiPropertyOptional({ maxLength: 128, nullable: true })
  category!: string | null;

  @ApiProperty({ type: [String], maxItems: 100 })
  tags!: string[];

  @ApiProperty({ maxLength: 32 })
  difficulty!: string;

  @ApiProperty({ type: 'array', items: { type: 'object' }, maxItems: 100 })
  learningPaths!: { pathId: string; moduleId: string }[];

  @ApiProperty({ type: [String], maxItems: 100 })
  prerequisites!: string[];

  @ApiProperty({ type: [String], maxItems: 100 })
  related!: string[];

  @ApiProperty({ type: [String], maxItems: 100 })
  labs!: string[];

  @ApiProperty({ type: [String], maxItems: 100 })
  authors!: string[];

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    nullable: true,
  })
  kubernetes!: Record<string, unknown> | null;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    nullable: true,
  })
  review!: Record<string, unknown> | null;

  @ApiProperty({ type: [String], maxItems: 100 })
  legacyUrls!: string[];

  @ApiProperty({ format: 'uuid' })
  contentId!: string;

  @ApiProperty({
    maxLength: 255,
    pattern: CANONICAL_ARTICLE_SLUG_PATTERN,
    example: 'articles/architecture/transactional-outbox',
  })
  slug!: string;

  @ApiProperty({ maxLength: 160 })
  title!: string;

  @ApiProperty({ maxLength: 500 })
  description!: string;

  @ApiProperty({ format: 'uuid' })
  publishedRevisionId!: string;

  @ApiProperty({ format: 'date-time' })
  publishedAt!: string;

  @ApiProperty({ maxLength: 2048 })
  url!: string;
}

export class PublicCatalogRedirectResponseDto {
  @ApiProperty({ maxLength: 512 })
  source!: string;

  @ApiProperty({ maxLength: 512 })
  destination!: string;

  @ApiProperty({ enum: ['article', 'path-module'] })
  kind!: 'article' | 'path-module';
}

export class PublicContentCatalogResponseDto {
  @ApiProperty({ enum: [1] })
  schema_version!: 1;

  @ApiProperty({ pattern: '^[a-f0-9]{40}$' })
  sourceCommitSha!: string;

  @ApiProperty({ pattern: '^[a-f0-9]{64}$' })
  checksumSha256!: string;

  @ApiProperty({ format: 'date-time' })
  generatedAt!: string;

  @ApiProperty({ type: PublicCatalogSiteResponseDto })
  site!: PublicCatalogSiteResponseDto;

  @ApiProperty({ type: [PublicCatalogTopicResponseDto], maxItems: 200 })
  topics!: PublicCatalogTopicResponseDto[];

  @ApiProperty({ type: [PublicCatalogCategoryResponseDto], maxItems: 500 })
  categories!: PublicCatalogCategoryResponseDto[];

  @ApiProperty({ type: [PublicCatalogPathResponseDto], maxItems: 100 })
  paths!: PublicCatalogPathResponseDto[];

  @ApiProperty({ type: [PublicCatalogArticleResponseDto], maxItems: 1000 })
  articles!: PublicCatalogArticleResponseDto[];

  @ApiProperty({ type: [PublicCatalogRedirectResponseDto], maxItems: 10000 })
  redirects!: PublicCatalogRedirectResponseDto[];
}

export class ContentSeoResponseDto {
  @ApiProperty({ maxLength: 160 })
  title!: string;

  @ApiProperty({ maxLength: 500 })
  description!: string;
}

export class PublicContentResponseDto {
  @ApiProperty({ format: 'uuid' })
  contentId!: string;

  @ApiProperty({ maxLength: 255 })
  contentKey!: string;

  @ApiProperty({ enum: ['article'] })
  contentType!: 'article';

  @ApiProperty({
    maxLength: 255,
    pattern: CANONICAL_ARTICLE_SLUG_PATTERN,
    example: 'articles/architecture/transactional-outbox',
  })
  slug!: string;

  @ApiProperty({ format: 'uuid' })
  publishedRevisionId!: string;

  @ApiProperty({ type: ContentDocumentResponseDto })
  document!: ContentDocumentResponseDto;

  @ApiProperty({ type: ContentSeoResponseDto })
  seo!: ContentSeoResponseDto;

  @ApiProperty({ format: 'date-time' })
  publishedAt!: string;
}
