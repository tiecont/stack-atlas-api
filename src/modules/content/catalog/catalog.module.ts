import { Module } from '@nestjs/common';
import { HttpSecurityModule } from '../../../common/http/security/http-security.module';
import { DatabaseModule } from '../../../database/database.module';
import { OriginGuard } from '../../../common/http/security/origin.guard';
import { AccountModule } from '../../identity/account/account.module';
import { SessionAuthGuard } from '../../identity/authentication/guards/session-auth.guard';
import { SessionModule } from '../../identity/session/session.module';
import { PlatformAuthorizationModule } from '../../identity/platform-authorization/platform-authorization.module';
import { PermissionGuard } from '../../identity/platform-authorization/guards/permission.guard';
import { AdminContentController } from './controllers/admin-content.controller';
import { PublicContentController } from './controllers/public-content.controller';
import { ContentCatalogRepository } from './repositories/content-catalog.repository';
import { ContentCatalogService } from './services/content-catalog.service';
import { GitContentImportService } from './services/git-content-import.service';

@Module({
  imports: [
    DatabaseModule,
    HttpSecurityModule,
    AccountModule,
    SessionModule,
    PlatformAuthorizationModule,
  ],
  controllers: [AdminContentController, PublicContentController],
  providers: [
    ContentCatalogRepository,
    ContentCatalogService,
    GitContentImportService,
    SessionAuthGuard,
    PermissionGuard,
    OriginGuard,
  ],
  exports: [ContentCatalogService],
})
export class CatalogModule {}
