import type { ConfigService } from '@nestjs/config';

export type NodeEnvironment = 'development' | 'test' | 'production';

export interface ApplicationConfig {
  environment: NodeEnvironment;
  port: number;
  database: {
    url: string;
    poolMax: number;
  };
  http: {
    apiPrefix: string;
    corsOrigins: string[];
  };
  session: {
    cookieName: string;
    cookiePath: string;
    ttlSeconds: number;
    secure: boolean;
  };
}

export function getApplicationConfig(config: ConfigService): ApplicationConfig {
  return config.getOrThrow<ApplicationConfig>('application');
}
