// Cryptographic building blocks of the chain.
//   sha256        - every block hash, transaction id and Merkle node
//   canonicalJson - the same data always serialises to the same bytes
//   sign/recover  - ECDSA on secp256k1 (the curve Bitcoin and Ethereum use)

import crypto from 'node:crypto';
import { SigningKey, computeAddress, recoverAddress } from 'ethers';

export const ZERO_HASH = '0'.repeat(64);

export const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');

/** JSON with sorted object keys: without this, key order would change a hash. */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export const addressOf = (privateKey) => computeAddress(new SigningKey(privateKey).publicKey);

export const signDigest = (hexDigest, privateKey) => new SigningKey(privateKey).sign(`0x${hexDigest}`).serialized;

/** The address that produced this signature, or null if it is malformed. */
export function recoverSigner(hexDigest, signature) {
  try {
    return recoverAddress(`0x${hexDigest}`, signature);
  } catch {
    return null;
  }
}

export const sameAddress = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
