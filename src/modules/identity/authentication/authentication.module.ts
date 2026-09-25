import { Module } from '@nestjs/common';
import { AccountController } from '../account/controllers/account.controller';
import { AccountModule } from '../account/account.module';
import { SessionModule } from '../session/session.module';
import { AuthenticationController } from './controllers/authentication.controller';
import { AuthenticationService } from './services/authentication.service';
import { OriginGuard } from './guards/origin.guard';
import { SessionAuthGuard } from './guards/session-auth.guard';

@Module({
  imports: [AccountModule, SessionModule],
  controllers: [AuthenticationController, AccountController],
  providers: [AuthenticationService, OriginGuard, SessionAuthGuard],
  exports: [OriginGuard, SessionAuthGuard],
})
export class AuthenticationModule {}
