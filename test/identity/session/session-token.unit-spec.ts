import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  createSessionToken,
  hashSessionToken,
  isSessionToken,
  sessionTokenFromCookieHeader,
} from '../../../src/modules/identity/session/helpers/session-token';

describe('session token helpers', () => {
  it('creates opaque 256-bit base64url credentials and hashes them', () => {
    const token = createSessionToken();
    expect(isSessionToken(token)).toBe(true);
    expect(hashSessionToken(token)).toBe(
      createHash('sha256').update(token).digest('hex'),
    );
    expect(hashSessionToken(token)).not.toBe(token);
  });

  it('accepts one well-formed cookie and rejects malformed or ambiguous cookies', () => {
    const token = createSessionToken();
    expect(
      sessionTokenFromCookieHeader(
        `other=x; atlas_session=${token}`,
        'atlas_session',
      ),
    ).toBe(token);
    expect(
      sessionTokenFromCookieHeader('atlas_session=short', 'atlas_session'),
    ).toBeNull();
    expect(
      sessionTokenFromCookieHeader(
        `atlas_session=${token}; atlas_session=${token}`,
        'atlas_session',
      ),
    ).toBeNull();
  });
});
