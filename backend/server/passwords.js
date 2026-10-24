// Password hashing with scrypt (memory-hard, built into Node — no native
// dependency). Stored format: scrypt$N$r$p$saltB64$hashB64

import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);
const PARAMS = { N: 16384, r: 8, p: 1 };
const KEY_LEN = 64;

export async function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 8) {
    throw new Error('Password must be at least 8 characters.');
  }
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, KEY_LEN, PARAMS);
  return ['scrypt', PARAMS.N, PARAMS.r, PARAMS.p, salt.toString('base64'), hash.toString('base64')].join('$');
}

export async function verifyPassword(password, stored) {
  const [scheme, N, r, p, saltB64, hashB64] = String(stored ?? '').split('$');
  if (scheme !== 'scrypt') return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scrypt(String(password ?? ''), Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(N),
    r: Number(r),
    p: Number(p),
  });
  return crypto.timingSafeEqual(actual, expected);
}

// Pre-computed so unknown usernames cost the same time as wrong passwords.
export const DUMMY_HASH = await hashPassword(crypto.randomBytes(16).toString('hex'));
