import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { configureHttp } from './app.config';
import { getApplicationConfig } from './config/application-config';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  configureHttp(app);
  app.enableShutdownHooks();
  const config = getApplicationConfig(app.get(ConfigService));
  await app.listen(config.port, '0.0.0.0');
}

void bootstrap();
