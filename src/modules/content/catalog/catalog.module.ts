import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../../database/database.module';
import { PlatformAuthorizationModule } from '../../identity/platform-authorization/platform-authorization.module';
import { ContentCatalogRepository } from './repositories/content-catalog.repository';
import { ContentCatalogService } from './services/content-catalog.service';

@Module({
  imports: [DatabaseModule, PlatformAuthorizationModule],
  providers: [ContentCatalogRepository, ContentCatalogService],
  exports: [ContentCatalogService],
})
export class CatalogModule {}
