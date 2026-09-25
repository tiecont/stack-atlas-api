import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../../database/database.module';
import { SessionService } from './services/session.service';

@Module({
  imports: [DatabaseModule],
  providers: [SessionService],
  exports: [SessionService],
})
export class SessionModule {}
