import { Module } from '@nestjs/common';
import { OriginGuard } from './origin.guard';

@Module({
  providers: [OriginGuard],
  exports: [OriginGuard],
})
export class HttpSecurityModule {}
