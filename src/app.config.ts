import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ProblemDetailsFilter } from './common/filters/problem-details.filter';
import { API_PREFIX } from './common/http/http.constants';
import { requestContextMiddleware } from './common/http/request-context.middleware';
import { ProblemDetailsDto } from './common/openapi/problem-details.dto';
import { getApplicationConfig } from './config/application-config';

export { API_PREFIX } from './common/http/http.constants';

export function configureHttp(app: INestApplication): void {
  const config = getApplicationConfig(app.get(ConfigService));
  app.use(requestContextMiddleware);
  app.setGlobalPrefix(API_PREFIX);
  app.useGlobalFilters(new ProblemDetailsFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  if (config.http.corsOrigins.length > 0) {
    app.enableCors({ origin: config.http.corsOrigins, credentials: true });
  }

  const openApiConfig = new DocumentBuilder()
    .setTitle('Stack Atlas API')
    .setDescription('Business and control-plane API for Stack Atlas.')
    .setVersion('0.1.0')
    .addCookieAuth(
      'sessionCookie',
      { type: 'apiKey', in: 'cookie', name: config.session.cookieName },
      'sessionCookie',
    )
    .build();
  const document = SwaggerModule.createDocument(app, openApiConfig, {
    extraModels: [ProblemDetailsDto],
  });
  SwaggerModule.setup('docs', app, document, { jsonDocumentUrl: 'docs-json' });
}
