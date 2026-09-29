import { Module } from '@nestjs/common';
import { HttpSecurityModule } from '../../../common/http/security/http-security.module';
import { DatabaseModule } from '../../../database/database.module';
import { AccountController } from './controllers/account.controller';
import { AccountRepository } from './repositories/account.repository';
import { AccountService } from './services/account.service';
import { PasswordHasher } from './services/password-hasher.service';

@Module({
  imports: [DatabaseModule, HttpSecurityModule],
  controllers: [AccountController],
  providers: [AccountRepository, AccountService, PasswordHasher],
  exports: [AccountService, PasswordHasher],
})
export class AccountModule {}
