import { getSchemaPath } from '@nestjs/swagger';
import type { ApiResponseOptions } from '@nestjs/swagger';
import { ProblemDetailsDto } from './problem-details.dto';

export function problemDetailsResponse(
  status: number,
  description: string,
): ApiResponseOptions {
  return {
    status,
    description,
    content: {
      'application/problem+json': {
        schema: { $ref: getSchemaPath(ProblemDetailsDto) },
      },
    },
  };
}
