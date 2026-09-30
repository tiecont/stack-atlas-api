import { Controller, Get, Header, Param } from '@nestjs/common';
import {
  ApiExtraModels,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
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
} from '../dto/content-catalog.dto';
import { withContentProblems } from '../helpers/content-http-problems';
import { ContentItemNotFoundError } from '../types/content-catalog.types';

@ApiTags('content')
@ApiExtraModels(
  ProblemDetailsDto,
  ContentDocumentResponseDto,
  ContentSeoResponseDto,
)
@Controller('content')
export class PublicContentController {
  constructor(private readonly catalog: ContentCatalogService) {}

  @Get(':slug')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Get a published content document by slug' })
  @ApiParam({ name: 'slug', description: 'URL-encoded content route slug' })
  @ApiOkResponse({ type: PublicContentResponseDto })
  @ApiResponse(problemDetailsResponse(400, 'Invalid content slug'))
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
