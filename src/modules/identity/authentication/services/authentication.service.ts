import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { getApplicationConfig } from '../../../../config/application-config';
import type { ApplicationConfig } from '../../../../config/application-config';
import { AccountService } from '../../account/services/account.service';
import type { Account } from '../../account/types/account.types';
import { PasswordHasher } from '../../account/services/password-hasher.service';
import { SessionService } from '../../session/services/session.service';
import { LoginDto } from '../dto/authentication.dto';

@Injectable()
export class AuthenticationService {
  private readonly config: ApplicationConfig;

  constructor(
    private readonly accounts: AccountService,
    private readonly passwordHasher: PasswordHasher,
    private readonly sessions: SessionService,
    configService: ConfigService,
  ) {
    this.config = getApplicationConfig(configService);
  }

  async login(input: LoginDto, response: Response): Promise<Account> {
    const credentials = await this.accounts.findForAuthentication(input.email);
    const matches = await this.passwordHasher.verify(
      input.password,
      credentials?.passwordHash ?? null,
    );
    if (!credentials || !matches) throw new UnauthorizedException();

    const session = await this.sessions.create(credentials.account.id);
    response.cookie(this.config.session.cookieName, session.token, {
      httpOnly: true,
      sameSite: 'lax',
      path: this.config.session.cookiePath,
      secure: this.config.session.secure,
      maxAge: this.config.session.ttlSeconds * 1000,
    });
    return credentials.account;
  }

  logout(sessionId: string, accountId: string): Promise<void> {
    return this.sessions.revoke(sessionId, accountId);
  }

  clearCookie(response: Response): void {
    response.clearCookie(this.config.session.cookieName, {
      httpOnly: true,
      sameSite: 'lax',
      path: this.config.session.cookiePath,
      secure: this.config.session.secure,
    });
  }
}
