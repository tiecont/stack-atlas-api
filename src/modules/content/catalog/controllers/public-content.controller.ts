import { Controller, Get, Header, Param, Query } from '@nestjs/common';
import {
  ApiExtraModels,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ProblemDetailsDto } from '../../../../common/openapi/problem-details.dto';
import { problemDetailsResponse } from '../../../../common/openapi/problem-response';
import { ContentCatalogService } from '../services/content-catalog.service';
import type { PublishedContentRecord } from '../types/content-catalog.types';
import {
  ContentDocumentResponseDto,
  ContentSeoResponseDto,
  PublicContentResponseDto,
  PublicContentSearchItemResponseDto,
  PublicContentSearchResponseDto,
  PublicContentCatalogResponseDto,
} from '../dto/content-catalog.dto';
import { withContentProblems } from '../helpers/content-http-problems';
import { ContentItemNotFoundError } from '../types/content-catalog.types';

@ApiTags('content')
@ApiExtraModels(
  ProblemDetailsDto,
  ContentDocumentResponseDto,
  ContentSeoResponseDto,
  PublicContentSearchItemResponseDto,
  PublicContentCatalogResponseDto,
)
@Controller('content')
export class PublicContentController {
  constructor(private readonly catalog: ContentCatalogService) {}

  @Get('search')
  @Header('Cache-Control', 'public, max-age=60, stale-while-revalidate=300')
  @ApiOperation({ summary: 'Search published article content' })
  @ApiQuery({ name: 'q', required: false, maxLength: 160 })
  @ApiOkResponse({ type: PublicContentSearchResponseDto })
  @ApiResponse(problemDetailsResponse(400, 'Invalid public content search'))
  searchPublished(
    @Query('q') query: unknown,
  ): Promise<PublicContentSearchResponseDto> {
    return withContentProblems(
      (async () => ({
        items: (await this.catalog.searchPublishedContent(query)).map(
          toPublicContentSearchItem,
        ),
      }))(),
    );
  }

  @Get('catalog')
  @Header('Cache-Control', 'public, max-age=60, stale-while-revalidate=300')
  @ApiOperation({ summary: 'Get the published content catalog metadata' })
  @ApiOkResponse({ type: PublicContentCatalogResponseDto })
  @ApiServiceUnavailableResponse(
    problemDetailsResponse(
      503,
      'Public content catalog is not ready or failed integrity validation',
    ),
  )
  getPublicCatalog(): Promise<PublicContentCatalogResponseDto> {
    return withContentProblems(
      (async () => {
        const catalog = await this.catalog.getPublicContentCatalog();
        return {
          schema_version: catalog.schema_version,
          sourceCommitSha: catalog.sourceCommitSha,
          checksumSha256: catalog.checksumSha256,
          generatedAt: catalog.createdAt.toISOString(),
          site: catalog.site,
          topics: catalog.topics,
          categories: catalog.categories,
          paths: catalog.paths,
          articles: catalog.articles,
          redirects: catalog.redirects,
        };
      })(),
    );
  }

  @Get(':slug')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Get a published content document by slug' })
  @ApiParam({
    name: 'slug',
    description:
      'URL-encoded canonical article route slug in articles/<domain>/<slug> form',
  })
  @ApiOkResponse({ type: PublicContentResponseDto })
  @ApiResponse(
    problemDetailsResponse(
      400,
      'Invalid canonical article route (code: invalid_content_route; retryable: false; message: The article route must match articles/<domain>/<slug>.)',
    ),
  )
  @ApiNotFoundResponse(
    problemDetailsResponse(404, 'Published content was not found'),
  )
  getPublished(@Param('slug') slug: string): Promise<PublicContentResponseDto> {
    return withContentProblems(
      (async () => {
        const published = await this.catalog.findPublishedBySlug(slug);
        if (!published) throw new ContentItemNotFoundError();
        return toPublicContentResponse(published);
      })(),
    );
  }
}

function toPublicContentSearchItem(
  published: PublishedContentRecord,
): PublicContentSearchItemResponseDto {
  return {
    contentId: published.contentId,
    contentKey: published.contentKey,
    contentType: published.contentType,
    slug: published.slug,
    publishedRevisionId: published.revisionId,
    title: published.document.title,
    description: published.document.description,
    publishedAt: published.publishedAt.toISOString(),
  };
}

function toPublicContentResponse(
  published: PublishedContentRecord,
): PublicContentResponseDto {
  return {
    contentId: published.contentId,
    contentKey: published.contentKey,
    contentType: published.contentType,
    slug: published.slug,
    publishedRevisionId: published.revisionId,
    document: published.document,
    seo: {
      title: published.document.title,
      description: published.document.description,
    },
    publishedAt: published.publishedAt.toISOString(),
  };
}
