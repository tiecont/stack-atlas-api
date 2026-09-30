import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthenticatedRequest } from '../../authentication/guards/session-auth.guard';
import { PlatformAuthorizationService } from '../services/platform-authorization.service';
import { REQUIRED_PLATFORM_PERMISSIONS } from './require-permissions';

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authorization: PlatformAuthorizationService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<Partial<AuthenticatedRequest>>();
    if (!request.principal) throw new UnauthorizedException();
    const required = this.reflector.getAllAndOverride<unknown>(
      REQUIRED_PLATFORM_PERMISSIONS,
      [context.getHandler(), context.getClass()],
    );
    if (
      !Array.isArray(required) ||
      required.length === 0 ||
      !(await this.authorization.hasPermissions(request.principal, required))
    ) {
      throw new ForbiddenException();
    }
    return true;
  }
}
