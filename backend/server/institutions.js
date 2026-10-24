// Institution lifecycle and per-institution signing.
//
// The platform owner (the institution that deployed the registry, e.g.
// Alliance University) is the "root" institution and signs with the server's
// own issuer key. Every other institution gets its own wallet on approval:
// the owner authorizes it on-chain with setIssuer() and funds it with enough
// ETH for gas. Credentials it issues are then recorded on-chain under its own
// address, which is what verification checks.

import { createIssuerWallet, decryptKey, encryptKey, slugify } from './wallets.js';

/**
 * @param {{
 *   chain: ReturnType<import('./chain.js').createChainBridge>,   // owner-signed bridge
 *   connect: (privateKey: string) => ReturnType<import('./chain.js').createChainBridge>,
 *   store: ReturnType<import('./store.js').createMemoryStore>,
 *   walletKey: Buffer,          // 32-byte key for encrypting institution wallets
 *   fundingWei: bigint,         // ETH sent to a newly approved institution for gas
 *   rootName: string,
 *   trustedIssuer?: string,     // overrides the root address (defaults to the contract owner)
 * }} deps
 */
export function createInstitutionService({ chain, connect, store, walletKey, fundingWei, rootName, trustedIssuer }) {
  const rootId = slugify(rootName);
  const bridges = new Map();
  let rootPromise = null;

  /** The platform owner's institution row, created on first use. */
  function root() {
    rootPromise ??= (async () => {
      const address = trustedIssuer ?? (await chain.owner());
      const existing = await store.getInstitution(rootId);
      if (existing) {
        if (existing.walletAddress?.toLowerCase() !== address.toLowerCase()) {
          return store.updateInstitution(rootId, { walletAddress: address, status: 'approved' });
        }
        return existing;
      }
      return store.createInstitution({
        id: rootId,
        name: rootName,
        kind: 'university',
        status: 'approved',
        walletAddress: address,
        source: 'platform-owner',
        approvedAt: new Date().toISOString(),
        approvedBy: 'system',
      });
    })().catch((err) => {
      rootPromise = null;
      throw err;
    });
    return rootPromise;
  }

  async function bridgeFor(institution) {
    if (!institution.walletKeyEnc) return chain; // root institution signs with the server key
    if (!bridges.has(institution.id)) {
      bridges.set(institution.id, connect(decryptKey(institution.walletKeyEnc, walletKey)));
    }
    return bridges.get(institution.id);
  }

  /** Institution acting for a request's user; throws a tagged error if it may not issue.
   *  Only university registrars issue - the platform admin manages institutions, not credentials. */
  async function forUser(user) {
    if (user.role !== 'institution' || !user.institutionId) {
      throw Object.assign(new Error('Only university registrars can issue or manage credentials.'), { status: 403 });
    }
    const inst = user.institutionId === rootId ? await root() : await store.getInstitution(user.institutionId);
    if (!inst) throw Object.assign(new Error('Your account is not linked to an institution.'), { status: 403 });
    if (inst.status !== 'approved') {
      throw Object.assign(new Error(`Your institution is ${inst.status}; it cannot issue or revoke credentials.`), {
        status: 403,
      });
    }
    return inst;
  }

  /** Is this on-chain issuer address one the platform vouches for? */
  async function trustedByAddress(address) {
    const r = await root();
    if (r.walletAddress?.toLowerCase() === String(address).toLowerCase()) return r;
    const inst = await store.findInstitutionByAddress(address);
    return inst?.status === 'approved' ? inst : null;
  }

  async function register({ name, kind = 'university', email = null, website = null, source = 'registration' }) {
    const id = slugify(name);
    if (id.length < 2) throw Object.assign(new Error('Institution name is too short.'), { status: 400 });
    if ((await store.getInstitution(id)) || (await store.findInstitutionByName(name))) {
      throw Object.assign(new Error('An institution with this name is already registered.'), { status: 409 });
    }
    return store.createInstitution({ id, name, kind, email, website, status: 'pending', source });
  }

  async function approve(id, actor) {
    const inst = await store.getInstitution(id);
    if (!inst) throw Object.assign(new Error('Institution not found.'), { status: 404 });
    if (inst.id === rootId) return inst;
    if (inst.status === 'approved') return inst;

    let { walletAddress, walletKeyEnc } = inst;
    if (!walletAddress) {
      const w = createIssuerWallet();
      walletAddress = w.address;
      walletKeyEnc = encryptKey(w.privateKey, walletKey);
      // Store the key before touching the chain so a failure can't orphan funds.
      await store.updateInstitution(id, { walletAddress, walletKeyEnc });
    }
    const setTx = await chain.setIssuer(walletAddress, inst.name, true);
    const fundTx = inst.kind === 'employer' ? null : await chain.fund(walletAddress, fundingWei);
    const updated = await store.updateInstitution(id, {
      status: 'approved',
      approvedAt: new Date().toISOString(),
      approvedBy: actor,
    });
    return { ...updated, setIssuerTx: setTx.txHash, fundingTx: fundTx?.txHash ?? null };
  }

  async function suspend(id, actor) {
    const inst = await store.getInstitution(id);
    if (!inst) throw Object.assign(new Error('Institution not found.'), { status: 404 });
    if (inst.id === rootId) throw Object.assign(new Error('The platform owner cannot be suspended.'), { status: 400 });
    if (inst.walletAddress) await chain.setIssuer(inst.walletAddress, inst.name, false);
    bridges.delete(id);
    return store.updateInstitution(id, { status: 'suspended', approvedBy: actor });
  }

  async function reject(id, actor) {
    const inst = await store.getInstitution(id);
    if (!inst) throw Object.assign(new Error('Institution not found.'), { status: 404 });
    if (inst.status !== 'pending') {
      throw Object.assign(new Error(`Only pending institutions can be rejected (this one is ${inst.status}).`), {
        status: 409,
      });
    }
    return store.updateInstitution(id, { status: 'rejected', approvedBy: actor });
  }

  /** Public view: never exposes the encrypted key. */
  const publicView = ({ walletKeyEnc: _k, ...rest }) => rest;

  return { rootId, root, bridgeFor, forUser, trustedByAddress, register, approve, suspend, reject, publicView };
}
