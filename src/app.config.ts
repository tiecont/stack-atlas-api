import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ProblemDetailsDto } from './common/openapi/problem-details.dto';
import { ProblemDetailsFilter } from './common/filters/problem-details.filter';
import { ValidationPipe } from '@nestjs/common';

export const API_PREFIX = 'api/v1';

export function configureHttp(app: INestApplication): void {
  app.setGlobalPrefix(API_PREFIX);
  app.useGlobalFilters(new ProblemDetailsFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  const config = app.get(ConfigService);
  const origins = config.get<string[]>('CORS_ORIGINS', []);
  if (origins.length > 0) app.enableCors({ origin: origins, credentials: true });

  const openApiConfig = new DocumentBuilder()
    .setTitle('Stack Atlas API')
    .setDescription('Business and control-plane API for Stack Atlas.')
    .setVersion('0.1.0')
    .addCookieAuth('stack_atlas_session', {
      type: 'apiKey',
      in: 'cookie',
      name: 'stack_atlas_session',
    }, 'stack_atlas_session')
    .build();
  const document = SwaggerModule.createDocument(app, openApiConfig, {
    extraModels: [ProblemDetailsDto],
  });
  SwaggerModule.setup('docs', app, document, { jsonDocumentUrl: 'docs-json' });
}
