import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiExtraModels,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { ProblemDetailsDto } from '../../../../common/openapi/problem-details.dto';
import { problemDetailsResponse } from '../../../../common/openapi/problem-response';
import { OriginGuard } from '../../../../common/http/security/origin.guard';
import {
  SessionAuthGuard,
  type AuthenticatedRequest,
} from '../../../identity/authentication/guards/session-auth.guard';
import { PLATFORM_PERMISSION } from '../../../identity/platform-authorization/constants/platform-permissions';
import { PermissionGuard } from '../../../identity/platform-authorization/guards/permission.guard';
import { RequirePermissions } from '../../../identity/platform-authorization/guards/require-permissions';
import { ContentCatalogService } from '../services/content-catalog.service';
import type {
  ContentLifecycleRecord,
  ContentRevisionRecord,
  ContentRevisionSummary,
  PublishedContentRecord,
} from '../types/content-catalog.types';
import {
  ContentDocumentResponseDto,
  ContentItemResponseDto,
  ContentListResponseDto,
  ContentRevisionListResponseDto,
  ContentRevisionResponseDto,
  ContentRevisionSummaryResponseDto,
  CreateContentDto,
  CreateContentRevisionDto,
  ListContentQueryDto,
  ListRevisionsQueryDto,
  PublishContentRevisionDto,
  PublishedContentResponseDto,
} from '../dto/content-catalog.dto';
import { withContentProblems } from '../helpers/content-http-problems';

@ApiTags('admin content')
@ApiCookieAuth('sessionCookie')
@ApiExtraModels(
  ProblemDetailsDto,
  ContentDocumentResponseDto,
  ContentItemResponseDto,
  ContentRevisionSummaryResponseDto,
  ContentRevisionResponseDto,
  PublishedContentResponseDto,
)
@Controller('admin/content')
export class AdminContentController {
  constructor(private readonly catalog: ContentCatalogService) {}

  @Get()
  @UseGuards(SessionAuthGuard, PermissionGuard)
  @RequirePermissions(PLATFORM_PERMISSION.CONTENT_READ)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'List admin content items' })
  @ApiOkResponse({ type: ContentListResponseDto })
  @ApiResponse(
    problemDetailsResponse(400, 'Invalid pagination or status filter'),
  )
  @ApiResponse(problemDetailsResponse(401, 'A valid session is required'))
  @ApiResponse(problemDetailsResponse(403, 'The session lacks content:read'))
  list(
    @Query() query: ListContentQueryDto,
    @Req() request: Request & AuthenticatedRequest,
  ): Promise<ContentListResponseDto> {
    return withContentProblems(
      this.catalog.listContent(query, request.principal),
    ).then((page) => ({
      items: page.items.map(toContentItemResponse),
      nextCursor: page.nextCursor,
    }));
  }

  @Post()
  @UseGuards(SessionAuthGuard, OriginGuard, PermissionGuard)
  @RequirePermissions(PLATFORM_PERMISSION.CONTENT_CREATE)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Create a content item and its first draft revision',
  })
  @ApiCreatedResponse({ type: ContentRevisionResponseDto })
  @ApiResponse(problemDetailsResponse(400, 'Invalid content request'))
  @ApiResponse(problemDetailsResponse(401, 'A valid session is required'))
  @ApiResponse(problemDetailsResponse(403, 'The session lacks content:create'))
  @ApiResponse(problemDetailsResponse(409, 'Content identity or slug conflict'))
  create(
    @Body() input: CreateContentDto,
    @Req() request: Request & AuthenticatedRequest,
  ): Promise<ContentRevisionResponseDto> {
    return withContentProblems(
      this.catalog.createArticle(
        input.contentKey,
        input.slug,
        input.document,
        request.principal,
      ),
    ).then(toContentRevisionResponse);
  }

  @Get(':id')
  @UseGuards(SessionAuthGuard, PermissionGuard)
  @RequirePermissions(PLATFORM_PERMISSION.CONTENT_READ)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Get content item metadata' })
  @ApiOkResponse({ type: ContentItemResponseDto })
  @ApiResponse(problemDetailsResponse(400, 'Invalid content item id'))
  @ApiResponse(problemDetailsResponse(401, 'A valid session is required'))
  @ApiResponse(problemDetailsResponse(403, 'The session lacks content:read'))
  @ApiResponse(problemDetailsResponse(404, 'Content item not found'))
  get(
    @Param('id', new ParseUUIDPipe()) contentId: string,
    @Req() request: Request & AuthenticatedRequest,
  ): Promise<ContentItemResponseDto> {
    return withContentProblems(
      this.catalog.getContent(contentId, request.principal),
    ).then(toContentItemResponse);
  }

  @Post(':id/submit-for-review')
  @UseGuards(SessionAuthGuard, OriginGuard, PermissionGuard)
  @RequirePermissions(PLATFORM_PERMISSION.CONTENT_UPDATE)
  @Header('Cache-Control', 'no-store')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Submit a draft content item for review' })
  @ApiOkResponse({ type: ContentItemResponseDto })
  @ApiResponse(problemDetailsResponse(400, 'Invalid content item id'))
  @ApiResponse(problemDetailsResponse(401, 'A valid session is required'))
  @ApiResponse(problemDetailsResponse(403, 'The session lacks content:update'))
  @ApiResponse(problemDetailsResponse(404, 'Content item not found'))
  @ApiResponse(problemDetailsResponse(409, 'Invalid lifecycle state'))
  submitForReview(
    @Param('id', new ParseUUIDPipe()) contentId: string,
    @Req() request: Request & AuthenticatedRequest,
  ): Promise<ContentItemResponseDto> {
    return withContentProblems(
      this.catalog.submitForReview(contentId, request.principal),
    ).then(toContentItemResponse);
  }

  @Get(':id/revisions')
  @UseGuards(SessionAuthGuard, PermissionGuard)
  @RequirePermissions(PLATFORM_PERMISSION.CONTENT_READ)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'List immutable content revisions' })
  @ApiOkResponse({ type: ContentRevisionListResponseDto })
  @ApiResponse(problemDetailsResponse(400, 'Invalid content item id or cursor'))
  @ApiResponse(problemDetailsResponse(401, 'A valid session is required'))
  @ApiResponse(problemDetailsResponse(403, 'The session lacks content:read'))
  @ApiResponse(problemDetailsResponse(404, 'Content item not found'))
  listRevisions(
    @Param('id', new ParseUUIDPipe()) contentId: string,
    @Query() query: ListRevisionsQueryDto,
    @Req() request: Request & AuthenticatedRequest,
  ): Promise<ContentRevisionListResponseDto> {
    return withContentProblems(
      this.catalog.listRevisions(contentId, query, request.principal),
    ).then((page) => ({
      items: page.items.map(toContentRevisionSummaryResponse),
      nextCursor: page.nextCursor,
    }));
  }

  @Get(':id/revisions/:revisionId')
  @UseGuards(SessionAuthGuard, PermissionGuard)
  @RequirePermissions(PLATFORM_PERMISSION.CONTENT_READ)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Get a structured content revision for preview' })
  @ApiOkResponse({ type: ContentRevisionResponseDto })
  @ApiResponse(problemDetailsResponse(400, 'Invalid content or revision id'))
  @ApiResponse(problemDetailsResponse(401, 'A valid session is required'))
  @ApiResponse(problemDetailsResponse(403, 'The session lacks content:read'))
  @ApiResponse(problemDetailsResponse(404, 'Content revision not found'))
  getRevision(
    @Param('id', new ParseUUIDPipe()) contentId: string,
    @Param('revisionId', new ParseUUIDPipe()) revisionId: string,
    @Req() request: Request & AuthenticatedRequest,
  ): Promise<ContentRevisionResponseDto> {
    return withContentProblems(
      this.catalog.getRevision(contentId, revisionId, request.principal),
    ).then(toContentRevisionResponse);
  }

  @Post(':id/revisions')
  @UseGuards(SessionAuthGuard, OriginGuard, PermissionGuard)
  @RequirePermissions(PLATFORM_PERMISSION.CONTENT_UPDATE)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Append a draft revision using optimistic concurrency',
  })
  @ApiCreatedResponse({ type: ContentRevisionResponseDto })
  @ApiResponse(problemDetailsResponse(400, 'Invalid revision request'))
  @ApiResponse(problemDetailsResponse(401, 'A valid session is required'))
  @ApiResponse(problemDetailsResponse(403, 'The session lacks content:update'))
  @ApiResponse(problemDetailsResponse(404, 'Content item not found'))
  @ApiResponse(
    problemDetailsResponse(409, 'Stale base revision or invalid state'),
  )
  appendRevision(
    @Param('id', new ParseUUIDPipe()) contentId: string,
    @Body() input: CreateContentRevisionDto,
    @Req() request: Request & AuthenticatedRequest,
  ): Promise<ContentRevisionResponseDto> {
    return withContentProblems(
      this.catalog.appendRevision(
        contentId,
        input.baseRevisionId,
        input.document,
        request.principal,
      ),
    ).then(toContentRevisionResponse);
  }

  @Post(':id/publish')
  @UseGuards(SessionAuthGuard, OriginGuard, PermissionGuard)
  @RequirePermissions(PLATFORM_PERMISSION.CONTENT_PUBLISH)
  @Header('Cache-Control', 'no-store')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Publish an immutable content revision' })
  @ApiOkResponse({ type: PublishedContentResponseDto })
  @ApiResponse(problemDetailsResponse(400, 'Invalid revision id'))
  @ApiResponse(problemDetailsResponse(401, 'A valid session is required'))
  @ApiResponse(problemDetailsResponse(403, 'The session lacks content:publish'))
  @ApiResponse(
    problemDetailsResponse(404, 'Content item or revision not found'),
  )
  @ApiResponse(problemDetailsResponse(409, 'Invalid or stale lifecycle state'))
  publish(
    @Param('id', new ParseUUIDPipe()) contentId: string,
    @Body() input: PublishContentRevisionDto,
    @Req() request: Request & AuthenticatedRequest,
  ): Promise<PublishedContentResponseDto> {
    return withContentProblems(
      this.catalog.publishRevision(
        contentId,
        input.revisionId,
        request.principal,
      ),
    ).then(toPublishedContentResponse);
  }

  @Post(':id/archive')
  @UseGuards(SessionAuthGuard, OriginGuard, PermissionGuard)
  @RequirePermissions(PLATFORM_PERMISSION.CONTENT_ARCHIVE)
  @Header('Cache-Control', 'no-store')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Archive content without deleting its history' })
  @ApiOkResponse({ type: ContentItemResponseDto })
  @ApiResponse(problemDetailsResponse(400, 'Invalid content item id'))
  @ApiResponse(problemDetailsResponse(401, 'A valid session is required'))
  @ApiResponse(problemDetailsResponse(403, 'The session lacks content:archive'))
  @ApiResponse(problemDetailsResponse(404, 'Content item not found'))
  @ApiResponse(problemDetailsResponse(409, 'Invalid lifecycle state'))
  archive(
    @Param('id', new ParseUUIDPipe()) contentId: string,
    @Req() request: Request & AuthenticatedRequest,
  ): Promise<ContentItemResponseDto> {
    return withContentProblems(
      this.catalog.archiveContent(contentId, request.principal),
    ).then(toContentItemResponse);
  }
}

function toContentItemResponse(
  item: ContentLifecycleRecord,
): ContentItemResponseDto {
  return {
    contentId: item.contentId,
    contentKey: item.contentKey,
    slug: item.slug,
    status: item.status,
    latestRevisionId: item.latestRevisionId,
    publishedRevisionId: item.publishedRevisionId,
    createdBy: item.createdBy,
    archivedAt: item.archivedAt?.toISOString() ?? null,
    archivedBy: item.archivedBy,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}

function toContentRevisionSummaryResponse(
  revision: ContentRevisionSummary,
): ContentRevisionSummaryResponseDto {
  return {
    contentId: revision.contentId,
    revisionId: revision.revisionId,
    revisionNumber: revision.revisionNumber,
    checksumSha256: revision.checksumSha256,
    revisionCreatedBy: revision.revisionCreatedBy,
    createdAt: revision.createdAt.toISOString(),
    publishedAt: revision.publishedAt?.toISOString() ?? null,
    publishedBy: revision.publishedBy,
  };
}

function toContentRevisionResponse(
  revision: ContentRevisionRecord,
): ContentRevisionResponseDto {
  return {
    contentId: revision.contentId,
    contentKey: revision.contentKey,
    slug: revision.slug,
    status: revision.status,
    contentType: revision.contentType,
    createdBy: revision.createdBy,
    revisionId: revision.revisionId,
    revisionNumber: revision.revisionNumber,
    checksumSha256: revision.checksumSha256,
    revisionCreatedBy: revision.revisionCreatedBy,
    createdAt: revision.createdAt.toISOString(),
    publishedAt: revision.publishedAt?.toISOString() ?? null,
    publishedBy: revision.publishedBy ?? null,
    document: revision.document,
  };
}

function toPublishedContentResponse(
  published: PublishedContentRecord,
): PublishedContentResponseDto {
  if (!published.publishedBy) {
    throw new Error('A new publication must include its authenticated actor.');
  }
  return {
    ...toContentRevisionResponse(published),
    publishedAt: published.publishedAt.toISOString(),
    publishedBy: published.publishedBy,
  };
}
