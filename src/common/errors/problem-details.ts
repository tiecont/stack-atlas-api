import { HttpException } from '@nestjs/common';
import { STATUS_CODES } from 'node:http';

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance: string;
  requestId?: string;
  code?: string;
  retryable?: boolean;
}

export class StructuredProblemException extends HttpException {
  readonly type: string;

  constructor(
    status: number,
    readonly code: string,
    detail: string,
    readonly retryable = false,
  ) {
    super(detail, status);
    this.type = `urn:stack-atlas:problem:${code}`;
  }
}

export function toProblemDetails(
  exception: unknown,
  instance: string,
  requestId?: string,
): ProblemDetails {
  const status =
    exception instanceof HttpException ? exception.getStatus() : 500;
  const problem: ProblemDetails = {
    type:
      exception instanceof StructuredProblemException
        ? exception.type
        : 'about:blank',
    title: STATUS_CODES[status] ?? 'Error',
    status,
    instance,
  };
  if (exception instanceof StructuredProblemException) {
    problem.code = exception.code;
    problem.retryable = exception.retryable;
    problem.detail = exception.message;
  }
  if (requestId) problem.requestId = requestId;

  return problem;
}
