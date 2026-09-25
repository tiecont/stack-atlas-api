import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { RequestWithContext } from '../http/request-context.middleware';
import { toProblemDetails } from '../errors/problem-details';

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<Request & RequestWithContext>();
    const response = context.getResponse<Response>();
    const problem = toProblemDetails(
      exception,
      request.path || '/',
      request.requestId,
    );

    response
      .status(problem.status)
      .setHeader('Cache-Control', 'no-store')
      .type('application/problem+json')
      .json(problem);
  }
}
