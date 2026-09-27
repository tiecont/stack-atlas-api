import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { getApplicationConfig } from '../../../config/application-config';

/** Enforces the configured exact-origin allowlist on browser mutations. */
@Injectable()
export class OriginGuard implements CanActivate {
  private readonly allowedOrigins: string[];

  constructor(configService: ConfigService) {
    this.allowedOrigins = getApplicationConfig(configService).http.corsOrigins;
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const origin = request.get('origin');
    if (origin && !this.allowedOrigins.includes(origin)) {
      throw new ForbiddenException();
    }
    return true;
  }
}
