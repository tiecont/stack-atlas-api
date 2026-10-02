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

const MAX_PAGE_SIZE = 100;

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

  @ApiProperty({ maxLength: 1024, example: 'engineering/transactional-outbox' })
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

  @ApiProperty({ example: 'engineering/transactional-outbox' })
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

  @ApiProperty({ example: 'engineering/transactional-outbox' })
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

  @ApiProperty({ maxLength: 2048 })
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

  @ApiProperty()
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
