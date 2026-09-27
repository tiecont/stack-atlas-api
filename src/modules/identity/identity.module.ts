import { Module } from '@nestjs/common';
import { AuthenticationModule } from './authentication/authentication.module';
import { AccountModule } from './account/account.module';
import { SessionModule } from './session/session.module';

@Module({
  imports: [AccountModule, SessionModule, AuthenticationModule],
})
export class IdentityModule {}
