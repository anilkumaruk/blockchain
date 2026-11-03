// A transaction is one signed statement by one account.
//   GENESIS      chain configuration (block 0 only)
//   SET_ISSUER   authority authorises or deactivates a university's address
//   ISSUE        a university records a certificate's fingerprint
//   REVOKE       the issuing university revokes it (nothing is ever deleted)
//   SET_PAUSED   authority's emergency stop for ISSUE and REVOKE
//
// No personal data is stored: only certificate numbers, hashes and addresses.

import crypto from 'node:crypto';
import { addressOf, canonicalJson, recoverSigner, sameAddress, sha256, signDigest } from './primitives.js';

export const TX_TYPES = ['GENESIS', 'SET_ISSUER', 'ISSUE', 'REVOKE', 'SET_PAUSED'];

const bodyOf = ({ type, from, payload, timestamp, salt }) => ({ type, from, payload, timestamp, salt });

export const transactionId = (tx) => sha256(canonicalJson(bodyOf(tx)));

export function createTransaction(type, payload, privateKey, timestamp = Date.now()) {
  // The salt makes two otherwise identical statements distinct transactions.
  const body = { type, from: addressOf(privateKey), payload, timestamp, salt: crypto.randomBytes(8).toString('hex') };
  const id = transactionId(body);
  return { ...body, id, signature: signDigest(id, privateKey) };
}

/** Is the id right, and was it really signed by `from`? Rule checks live in state.js. */
export function checkTransaction(tx) {
  if (!TX_TYPES.includes(tx.type)) return 'unknown transaction type';
  if (transactionId(tx) !== tx.id) return 'transaction id does not match its contents';
  const signer = recoverSigner(tx.id, tx.signature);
  if (!signer || !sameAddress(signer, tx.from)) return 'signature was not made by the sender';
  return null;
}
