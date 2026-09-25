import { describe, expect, it } from 'vitest';
import { PasswordHasher } from './password-hasher.service';

describe('PasswordHasher', () => {
  it('stores an adaptive scrypt hash and verifies without exposing the password', async () => {
    const hasher = new PasswordHasher();
    const password = 'correct horse battery staple';
    const encodedHash = await hasher.hash(password);

    expect(encodedHash).toMatch(/^scrypt\$32768\$8\$3\$[a-f0-9]{32}\$[a-f0-9]{128}$/);
    expect(encodedHash).not.toContain(password);
    await expect(hasher.verify(password, encodedHash)).resolves.toBe(true);
    await expect(hasher.verify('a different password', encodedHash)).resolves.toBe(false);
    await expect(hasher.verify(password, null)).resolves.toBe(false);
  });
});
