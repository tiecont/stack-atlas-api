import type { ApplicationConfig, NodeEnvironment } from './application-config';
import { API_PREFIX } from '../common/http/http.constants';

const MAX_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
const DEFAULT_WEB_ORIGIN = 'http://localhost:3001';

function isNodeEnvironment(value: string): value is NodeEnvironment {
  return value === 'development' || value === 'test' || value === 'production';
}

function parseInteger(
  value: unknown,
  name: string,
  defaultValue: number,
  minimum: number,
  maximum: number,
): number {
  const raw = value === undefined ? String(defaultValue) : String(value);
  if (!/^\d+$/.test(raw)) {
    throw new Error(
      `${name} must be an integer between ${minimum} and ${maximum}.`,
    );
  }

  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(
      `${name} must be an integer between ${minimum} and ${maximum}.`,
    );
  }
  return parsed;
}

function parseOrigins(value: unknown, environment: NodeEnvironment): string[] {
  const raw = value === undefined ? DEFAULT_WEB_ORIGIN : String(value);
  const origins = raw
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  for (const origin of origins) {
    if (origin === '*') {
      throw new Error(
        'CORS_ORIGINS must contain exact HTTP or HTTPS origins, using HTTPS in production.',
      );
    }
    let parsedOrigin: URL;
    try {
      parsedOrigin = new URL(origin);
    } catch {
      throw new Error('CORS_ORIGINS must contain valid origin URLs.');
    }

    if (
      !['http:', 'https:'].includes(parsedOrigin.protocol) ||
      parsedOrigin.origin !== origin ||
      (environment === 'production' && parsedOrigin.protocol !== 'https:')
    ) {
      throw new Error(
        'CORS_ORIGINS must contain exact HTTP or HTTPS origins, using HTTPS in production.',
      );
    }
  }

  return [...new Set(origins)];
}

export function validateEnvironment(
  values: Record<string, unknown>,
): Record<string, unknown> {
  const environment = String(values['NODE_ENV'] ?? 'development');
  if (!isNodeEnvironment(environment)) {
    throw new Error('NODE_ENV must be development, test, or production.');
  }
  const nodeEnvironment = environment;

  const databaseUrl = String(values['DATABASE_URL'] ?? '');
  let parsedDatabaseUrl: URL;
  try {
    parsedDatabaseUrl = new URL(databaseUrl);
  } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL connection URL.');
  }
  if (
    !['postgres:', 'postgresql:'].includes(parsedDatabaseUrl.protocol) ||
    !parsedDatabaseUrl.hostname ||
    parsedDatabaseUrl.pathname.length < 2
  ) {
    throw new Error(
      'DATABASE_URL must be a PostgreSQL URL with a host and database name.',
    );
  }

  const port = parseInteger(values['PORT'], 'PORT', 3000, 1, 65_535);
  const poolMax = parseInteger(
    values['DB_POOL_MAX'],
    'DB_POOL_MAX',
    10,
    1,
    100,
  );
  const ttlSeconds = parseInteger(
    values['SESSION_TTL_SECONDS'],
    'SESSION_TTL_SECONDS',
    7 * 24 * 60 * 60,
    1,
    MAX_SESSION_TTL_SECONDS,
  );
  const cookieName = String(
    values['SESSION_COOKIE_NAME'] ?? 'stack_atlas_session',
  );
  if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/.test(cookieName)) {
    throw new Error('SESSION_COOKIE_NAME must be a valid cookie name.');
  }

  const application: ApplicationConfig = {
    environment: nodeEnvironment,
    port,
    database: {
      url: databaseUrl,
      poolMax,
    },
    http: {
      apiPrefix: API_PREFIX,
      corsOrigins: parseOrigins(values['CORS_ORIGINS'], nodeEnvironment),
    },
    session: {
      cookieName,
      cookiePath: `/${API_PREFIX}`,
      ttlSeconds,
      secure: nodeEnvironment === 'production',
    },
  };

  return { ...values, application };
}
