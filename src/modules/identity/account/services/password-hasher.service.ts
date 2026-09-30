import { Injectable } from '@nestjs/common';
import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto';
import type { ScryptOptions } from 'node:crypto';

const KEY_LENGTH = 64;
const SCRYPT_OPTIONS: ScryptOptions = {
  N: 32_768,
  r: 8,
  p: 3,
  maxmem: 64 * 1024 * 1024,
};
const SCRYPT_PREFIX = 'scrypt$32768$8$3';
const DUMMY_SALT = Buffer.from('4f53cda18c2baa0c0354bb5f9a3ecbe5', 'hex');

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, KEY_LENGTH, SCRYPT_OPTIONS, (error, key) => {
      if (error) reject(error);
      else resolve(Buffer.from(key));
    });
  });
}

@Injectable()
export class PasswordHasher {
  async hash(password: string): Promise<string> {
    const salt = randomBytes(16);
    const key = await derive(password, salt);
    return `${SCRYPT_PREFIX}$${salt.toString('hex')}$${key.toString('hex')}`;
  }

  async verify(password: string, encodedHash: string | null): Promise<boolean> {
    if (encodedHash === null) {
      const derived = await derive(password, DUMMY_SALT);
      timingSafeEqual(derived, Buffer.alloc(KEY_LENGTH));
      return false;
    }

    const parts = encodedHash.split('$');
    const saltHex = parts[4];
    const keyHex = parts[5];
    if (
      parts.length !== 6 ||
      parts.slice(0, 4).join('$') !== SCRYPT_PREFIX ||
      !saltHex ||
      !/^[a-f0-9]{32}$/.test(saltHex) ||
      !keyHex ||
      !/^[a-f0-9]{128}$/.test(keyHex)
    ) {
      const derived = await derive(password, DUMMY_SALT);
      timingSafeEqual(derived, Buffer.alloc(KEY_LENGTH));
      return false;
    }

    const expected = Buffer.from(keyHex, 'hex');
    const actual = await derive(password, Buffer.from(saltHex, 'hex'));
    return timingSafeEqual(actual, expected);
  }
}
