// Institution issuer wallets. Each approved institution gets its own
// Ethereum key so the contract records *which* institution issued a
// credential. Keys are stored encrypted (AES-256-GCM) and only decrypted in
// memory when that institution signs a transaction.

import crypto from 'node:crypto';
import { Wallet } from 'ethers';

export function createIssuerWallet() {
  const w = Wallet.createRandom();
  return { address: w.address, privateKey: w.privateKey };
}

/** @param {Buffer} key 32-byte encryption key */
export function encryptKey(privateKey, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(privateKey, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), ct.toString('base64')].join(':');
}

export function decryptKey(blob, key) {
  const [version, ivB64, tagB64, ctB64] = String(blob).split(':');
  if (version !== 'v1') throw new Error('Unknown wallet key format');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8');
}

export const slugify = (name) =>
  String(name)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
