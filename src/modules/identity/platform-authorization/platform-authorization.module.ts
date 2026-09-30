import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../../database/database.module';
import { AuthenticationModule } from '../authentication/authentication.module';
import { PermissionGuard } from './guards/permission.guard';
import { PlatformAuthorizationRepository } from './repositories/platform-authorization.repository';
import { PlatformAuthorizationService } from './services/platform-authorization.service';

@Module({
  imports: [DatabaseModule, AuthenticationModule],
  providers: [
    PlatformAuthorizationRepository,
    PlatformAuthorizationService,
    PermissionGuard,
  ],
  exports: [
    PlatformAuthorizationService,
    PermissionGuard,
    AuthenticationModule,
  ],
})
export class PlatformAuthorizationModule {}
