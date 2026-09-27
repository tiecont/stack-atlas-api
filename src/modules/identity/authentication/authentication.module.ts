import { Module } from '@nestjs/common';
import { HttpSecurityModule } from '../../../common/http/security/http-security.module';
import { AccountModule } from '../account/account.module';
import { SessionModule } from '../session/session.module';
import { CurrentAccountController } from './controllers/current-account.controller';
import { AuthenticationController } from './controllers/authentication.controller';
import { AuthenticationService } from './services/authentication.service';
import { SessionAuthGuard } from './guards/session-auth.guard';

@Module({
  imports: [AccountModule, SessionModule, HttpSecurityModule],
  controllers: [AuthenticationController, CurrentAccountController],
  providers: [AuthenticationService, SessionAuthGuard],
  exports: [SessionAuthGuard],
})
export class AuthenticationModule {}
