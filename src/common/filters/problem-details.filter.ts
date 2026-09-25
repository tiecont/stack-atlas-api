import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { toProblemDetails } from '../errors/problem-details';

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<Request>();
    const response = context.getResponse<Response>();
    const problem = toProblemDetails(exception, request.path || '/');

    response
      .status(problem.status)
      .type('application/problem+json')
      .json(problem);
  }
}
