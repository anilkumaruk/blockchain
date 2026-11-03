// World state: what the chain currently says, derived ONLY by replaying
// transactions from block 0. It is never edited directly, so it can always be
// rebuilt and checked. apply() enforces the rules and returns an undo function,
// which lets a validator test a whole block before accepting it.

import { sameAddress } from './primitives.js';

export class ChainRuleError extends Error {
  constructor(reason) {
    super(`Blockchain rule violated: ${reason}`);
    this.name = 'ChainRuleError';
    this.reason = reason;
  }
}

const key = (address) => String(address).toLowerCase();
const hashKey = (hash) => String(hash).toLowerCase().replace(/^0x/, '');

export class LedgerState {
  constructor() {
    this.config = null; // { chainName, authority, validators, difficulty }
    this.issuers = new Map();
    this.certificates = new Map(); // credentialId -> record
    this.byHash = new Map(); // certificate hash -> credentialId
    this.byCertNo = new Map();
    this.paused = false;
    this.txCount = 0;
  }

  requireAuthority(tx) {
    if (!this.config || !sameAddress(tx.from, this.config.authority)) throw new ChainRuleError('OwnableUnauthorizedAccount');
  }

  requireActiveIssuer(tx) {
    if (this.paused) throw new ChainRuleError('EnforcedPause');
    if (!this.issuers.get(key(tx.from))?.active) throw new ChainRuleError('NotAuthorizedIssuer');
  }

  /** Applies one transaction; throws ChainRuleError if it breaks a rule. Returns an undo function. */
  apply(tx, blockIndex) {
    const undo = this[`apply${tx.type}`]?.(tx, blockIndex);
    if (!undo) throw new ChainRuleError('UnknownTransactionType');
    this.txCount += 1;
    return () => {
      this.txCount -= 1;
      undo();
    };
  }

  applyGENESIS(tx, blockIndex) {
    if (this.config || blockIndex !== 0) throw new ChainRuleError('GenesisAlreadyExists');
    const { chainName, authority, authorityName, validators, difficulty } = tx.payload;
    if (!sameAddress(tx.from, authority)) throw new ChainRuleError('OwnableUnauthorizedAccount');
    this.config = { chainName, authority, validators, difficulty };
    this.issuers.set(key(authority), { address: authority, name: authorityName, active: true, sinceBlock: 0 });
    return () => {
      this.config = null;
      this.issuers.delete(key(authority));
    };
  }

  applySET_ISSUER(tx, blockIndex) {
    this.requireAuthority(tx);
    const { address, name, active } = tx.payload;
    const before = this.issuers.get(key(address));
    this.issuers.set(key(address), {
      address,
      name: name ?? before?.name,
      active: Boolean(active),
      sinceBlock: before?.sinceBlock ?? blockIndex,
    });
    return () => (before ? this.issuers.set(key(address), before) : this.issuers.delete(key(address)));
  }

  applySET_PAUSED(tx) {
    this.requireAuthority(tx);
    const before = this.paused;
    this.paused = Boolean(tx.payload.paused);
    return () => {
      this.paused = before;
    };
  }

  applyISSUE(tx, blockIndex) {
    this.requireActiveIssuer(tx);
    const { credentialId, certNo = null, certHash, fileHash = null, marksHash = null } = tx.payload;
    if (!credentialId || !certHash) throw new ChainRuleError('EmptyValue');
    if (this.certificates.has(credentialId)) throw new ChainRuleError('CredentialAlreadyExists');
    if (certNo && this.byCertNo.has(certNo.toLowerCase())) throw new ChainRuleError('CredentialAlreadyExists');
    const hashes = [certHash, fileHash].filter(Boolean).map(hashKey);
    if (hashes.some((h) => this.byHash.has(h))) throw new ChainRuleError('HashAlreadyRegistered');

    this.certificates.set(credentialId, {
      credentialId,
      certNo,
      certHash: hashKey(certHash),
      fileHash: fileHash ? hashKey(fileHash) : null,
      marksHash,
      issuer: tx.from,
      status: 'valid',
      issuedAt: tx.timestamp,
      revokedAt: null,
      reasonHash: null,
      events: [{ type: 'issued', txId: tx.id, block: blockIndex, at: tx.timestamp, issuer: tx.from, hash: hashKey(certHash) }],
    });
    hashes.forEach((h) => this.byHash.set(h, credentialId));
    if (certNo) this.byCertNo.set(certNo.toLowerCase(), credentialId);
    return () => {
      this.certificates.delete(credentialId);
      hashes.forEach((h) => this.byHash.delete(h));
      if (certNo) this.byCertNo.delete(certNo.toLowerCase());
    };
  }

  applyREVOKE(tx, blockIndex) {
    this.requireActiveIssuer(tx);
    const { credentialId, reasonHash = null } = tx.payload;
    const cert = this.certificates.get(credentialId);
    if (!cert) throw new ChainRuleError('CredentialNotFound');
    if (!sameAddress(cert.issuer, tx.from)) throw new ChainRuleError('NotOriginalIssuer');
    if (cert.status === 'revoked') throw new ChainRuleError('AlreadyRevoked');
    Object.assign(cert, { status: 'revoked', revokedAt: tx.timestamp, reasonHash });
    cert.events.push({ type: 'revoked', txId: tx.id, block: blockIndex, at: tx.timestamp, issuer: tx.from, reasonHash });
    return () => {
      Object.assign(cert, { status: 'valid', revokedAt: null, reasonHash: null });
      cert.events.pop();
    };
  }

  lookup(idOrCertNo) {
    return (
      this.certificates.get(idOrCertNo) ??
      this.certificates.get(this.byCertNo.get(String(idOrCertNo).toLowerCase())) ??
      null
    );
  }

  lookupHash(hash) {
    return this.certificates.get(this.byHash.get(hashKey(hash))) ?? null;
  }
}
