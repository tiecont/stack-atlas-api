import { createHash, randomBytes } from 'node:crypto';

const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function createSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function isSessionToken(value: string): boolean {
  return SESSION_TOKEN_PATTERN.test(value);
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function sessionTokenFromCookieHeader(
  cookieHeader: string | undefined,
  cookieName: string,
): string | null {
  if (!cookieHeader) return null;
  const prefix = `${cookieName}=`;
  const matchingCookies = cookieHeader
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.startsWith(prefix));
  if (matchingCookies.length !== 1) return null;

  const matchingCookie = matchingCookies[0];
  if (!matchingCookie) return null;
  const token = matchingCookie.slice(prefix.length);
  return isSessionToken(token) ? token : null;
}
