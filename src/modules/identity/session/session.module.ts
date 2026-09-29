import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../../database/database.module';
import { SessionRepository } from './repositories/session.repository';
import { SessionService } from './services/session.service';

@Module({
  imports: [DatabaseModule],
  providers: [SessionRepository, SessionService],
  exports: [SessionService],
})
export class SessionModule {}
