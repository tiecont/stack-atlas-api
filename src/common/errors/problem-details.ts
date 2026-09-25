import { HttpException } from '@nestjs/common';
import { STATUS_CODES } from 'node:http';

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance: string;
}

export function toProblemDetails(
  exception: unknown,
  instance: string,
): ProblemDetails {
  const status = exception instanceof HttpException ? exception.getStatus() : 500;
  const problem: ProblemDetails = {
    type: 'about:blank',
    title: STATUS_CODES[status] ?? 'Error',
    status,
    instance,
  };

  return problem;
}
