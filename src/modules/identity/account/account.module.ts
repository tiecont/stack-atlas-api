import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../../database/database.module';
import { AccountService } from './services/account.service';
import { PasswordHasher } from './services/password-hasher.service';

@Module({
  imports: [DatabaseModule],
  providers: [AccountService, PasswordHasher],
  exports: [AccountService, PasswordHasher],
})
export class AccountModule {}
