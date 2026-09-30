import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnvironment } from './config/environment';
import { HealthModule } from './modules/health/health.module';
import { DatabaseModule } from './database/database.module';
import { IdentityModule } from './modules/identity/identity.module';
import { ContentModule } from './modules/content/content.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnvironment,
    }),
    DatabaseModule,
    HealthModule,
    IdentityModule,
    ContentModule,
  ],
})
export class AppModule {}
