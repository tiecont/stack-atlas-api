import { Module } from '@nestjs/common';
import { AuthenticationModule } from './authentication/authentication.module';
import { AccountModule } from './account/account.module';
import { SessionModule } from './session/session.module';
import { PlatformAuthorizationModule } from './platform-authorization/platform-authorization.module';

@Module({
  imports: [
    AccountModule,
    SessionModule,
    AuthenticationModule,
    PlatformAuthorizationModule,
  ],
})
export class IdentityModule {}
