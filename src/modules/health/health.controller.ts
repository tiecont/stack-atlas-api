import { Controller, Get } from '@nestjs/common';
import {
  ApiExtraModels,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import { ProblemDetailsDto } from '../../common/openapi/problem-details.dto';
import { HealthService } from './health.service';

@ApiTags('health')
@ApiExtraModels(ProblemDetailsDto)
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @ApiOperation({ summary: 'Check that the API process is alive.' })
  @ApiOkResponse({
    description: 'The API process can accept requests.',
    schema: { type: 'object', properties: { status: { type: 'string', enum: ['ok'] } } },
  })
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('ready')
  @ApiOperation({ summary: 'Check that the API and PostgreSQL are ready.' })
  @ApiOkResponse({
    description: 'PostgreSQL accepted the readiness probe.',
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['ok'] },
        dependencies: {
          type: 'object',
          properties: { postgres: { type: 'string', enum: ['ok'] } },
          required: ['postgres'],
        },
      },
      required: ['status', 'dependencies'],
    },
  })
  @ApiResponse({
    status: 503,
    description: 'PostgreSQL did not accept the readiness probe.',
    content: {
      'application/problem+json': {
        schema: { $ref: getSchemaPath(ProblemDetailsDto) },
      },
    },
  })
  getReadiness(): ReturnType<HealthService['getReadiness']> {
    return this.healthService.getReadiness();
  }
}
