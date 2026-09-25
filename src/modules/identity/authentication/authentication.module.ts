import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../../database/database.module';
import { AuthenticationController } from './authentication.controller';
import { AuthenticationService } from './authentication.service';
import { OriginGuard } from './origin.guard';
import { PasswordHasher } from './password-hasher.service';
import { SessionAuthGuard } from './session-auth.guard';

@Module({
  imports: [DatabaseModule],
  controllers: [AuthenticationController],
  providers: [AuthenticationService, OriginGuard, PasswordHasher, SessionAuthGuard],
  exports: [OriginGuard, PasswordHasher, SessionAuthGuard],
})
export class AuthenticationModule {}
