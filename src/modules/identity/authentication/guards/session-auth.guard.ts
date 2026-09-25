import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { getApplicationConfig } from '../../../../config/application-config';
import { AccountService } from '../../account/services/account.service';
import type { Account } from '../../account/services/account.service';
import { SessionService } from '../../session/services/session.service';
import { sessionTokenFromCookieHeader } from '../../session/helpers/session-token';
import type { AuthenticatedPrincipal } from '../types/authenticated-principal';

export interface AuthenticatedRequest {
  account: Account;
  principal: AuthenticatedPrincipal;
}

@Injectable()
export class SessionAuthGuard implements CanActivate {
  private readonly cookieName: string;

  constructor(
    private readonly sessions: SessionService,
    private readonly accounts: AccountService,
    configService: ConfigService,
  ) {
    this.cookieName = getApplicationConfig(configService).session.cookieName;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<Request & AuthenticatedRequest>();
    const token = sessionTokenFromCookieHeader(
      request.headers.cookie,
      this.cookieName,
    );
    if (!token) throw new UnauthorizedException();

    const session = await this.sessions.findActiveByToken(token);
    if (!session) throw new UnauthorizedException();
    const account = await this.accounts.findById(session.accountId);
    if (!account) throw new UnauthorizedException();

    request.account = account;
    request.principal = {
      accountId: account.id,
      sessionId: session.sessionId,
      email: account.email,
    };
    return true;
  }
}
