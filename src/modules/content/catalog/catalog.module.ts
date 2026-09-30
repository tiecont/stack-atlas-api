import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../../database/database.module';
import { ContentCatalogRepository } from './repositories/content-catalog.repository';
import { ContentCatalogService } from './services/content-catalog.service';

@Module({
  imports: [DatabaseModule],
  providers: [ContentCatalogRepository, ContentCatalogService],
  exports: [ContentCatalogService],
})
export class CatalogModule {}
