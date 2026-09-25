const ENVIRONMENTS = new Set(['development', 'test', 'production']);

export function validateEnvironment(
  values: Record<string, unknown>,
): Record<string, unknown> {
  const environment = String(values['NODE_ENV'] ?? 'development');
  if (!ENVIRONMENTS.has(environment)) {
    throw new Error('NODE_ENV must be development, test, or production.');
  }

  const port = Number(values['PORT'] ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('PORT must be an integer between 1 and 65535.');
  }

  const databaseUrl = String(values['DATABASE_URL'] ?? '');
  let parsedDatabaseUrl: URL;
  try {
    parsedDatabaseUrl = new URL(databaseUrl);
  } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL connection URL.');
  }
  if (!['postgres:', 'postgresql:'].includes(parsedDatabaseUrl.protocol)) {
    throw new Error('DATABASE_URL must use the postgres or postgresql scheme.');
  }

  const poolMax = Number(values['DB_POOL_MAX'] ?? 10);
  if (!Number.isInteger(poolMax) || poolMax < 1 || poolMax > 100) {
    throw new Error('DB_POOL_MAX must be an integer between 1 and 100.');
  }

  const corsOrigins = String(values['CORS_ORIGINS'] ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  for (const origin of corsOrigins) {
    if (origin === '*') {
      throw new Error('CORS_ORIGINS must contain exact HTTP or HTTPS origins.');
    }
    let parsedOrigin: URL;
    try {
      parsedOrigin = new URL(origin);
    } catch {
      throw new Error('CORS_ORIGINS must contain valid origin URLs.');
    }
    if (
      !['http:', 'https:'].includes(parsedOrigin.protocol) ||
      parsedOrigin.origin !== origin
    ) {
      throw new Error('CORS_ORIGINS must contain exact HTTP or HTTPS origins.');
    }
  }

  return {
    ...values,
    NODE_ENV: environment,
    PORT: port,
    DATABASE_URL: databaseUrl,
    DB_POOL_MAX: poolMax,
    CORS_ORIGINS: corsOrigins,
  };
}
