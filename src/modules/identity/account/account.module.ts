import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../../database/database.module';
import { AuthenticationModule } from '../authentication/authentication.module';
import { AccountController } from './account.controller';
import { AccountService } from './account.service';

@Module({
  imports: [DatabaseModule, AuthenticationModule],
  controllers: [AccountController],
  providers: [AccountService],
})
export class AccountModule {}
