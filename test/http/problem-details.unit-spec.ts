import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { toProblemDetails } from '../../src/common/errors/problem-details';

describe('toProblemDetails', () => {
  it('returns a client error without reflecting untrusted exception text', () => {
    expect(
      toProblemDetails(
        new BadRequestException('token=should-not-leak'),
        '/api/v1/items',
      ),
    ).toEqual({
      type: 'about:blank',
      title: 'Bad Request',
      status: 400,
      instance: '/api/v1/items',
    });
  });

  it('does not expose internal exception messages for server errors', () => {
    expect(
      toProblemDetails(new Error('database password leaked'), '/api/v1/items'),
    ).toEqual({
      type: 'about:blank',
      title: 'Internal Server Error',
      status: 500,
      instance: '/api/v1/items',
    });
  });
});
