import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { REQUEST_ID_HEADER } from './http.constants';

export interface RequestWithContext extends Request {
  requestId?: string;
}

export function requestContextMiddleware(
  request: RequestWithContext,
  response: Response,
  next: NextFunction,
): void {
  const requestId = randomUUID();
  request.requestId = requestId;
  response.setHeader(REQUEST_ID_HEADER, requestId);
  next();
}
