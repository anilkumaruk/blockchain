// Institution lifecycle.
//
// Every university signs its own transactions in MetaMask; this server holds no
// keys. An institution registers with its MetaMask address and stays pending.
// The platform admin then authorises that address in the smart contract
// (setIssuer, signed in the admin's own MetaMask), and approval here only
// confirms that the contract says so. Suspension works the same way in reverse.

export const slugify = (name) =>
  String(name)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const fail = (status, message, code) => Object.assign(new Error(message), { status, code });

/**
 * @param {{
 *   chain: ReturnType<import('./chain.js').createChainBridge>,   // read-only contract access
 *   store: ReturnType<import('./store.js').createMemoryStore>,
 * }} deps
 */
export function createInstitutionService({ chain, store }) {
  async function forUser(user) {
    if (user.role !== 'institution' || !user.institutionId) {
      throw fail(403, 'Only university registrars can issue or manage credentials.');
    }
    const inst = await store.getInstitution(user.institutionId);
    if (!inst) throw fail(403, 'Your account is not linked to an institution.');
    if (inst.status !== 'approved') throw fail(403, `Your institution is ${inst.status}; it cannot issue or revoke credentials.`);
    return inst;
  }

  /** Is this on-chain issuer address an approved institution? */
  async function trustedByAddress(address) {
    const inst = await store.findInstitutionByAddress(address);
    return inst?.status === 'approved' ? inst : null;
  }

  async function register({ name, kind = 'university', email = null, website = null, walletAddress, source = 'registration' }) {
    const id = slugify(name);
    if (id.length < 2) throw fail(400, 'Institution name is too short.');
    if (!ADDRESS_PATTERN.test(String(walletAddress ?? ''))) {
      throw fail(400, 'Enter the MetaMask address the institution will sign with (0x followed by 40 hex characters).');
    }
    if ((await store.getInstitution(id)) || (await store.findInstitutionByName(name))) {
      throw fail(409, 'An institution with this name is already registered.');
    }
    if (await store.findInstitutionByAddress(walletAddress)) throw fail(409, 'This wallet address is already registered.');
    return store.createInstitution({ id, name, kind, email, website, walletAddress, status: 'pending', source });
  }

  /** Confirms an approval the platform admin already signed in the contract. */
  async function approve(id, actor) {
    const inst = await store.getInstitution(id);
    if (!inst) throw fail(404, 'Institution not found.');
    if (inst.status === 'approved') return inst;
    if (!inst.walletAddress) throw fail(409, 'This institution has no wallet address.');
    const onChain = await chain.issuer(inst.walletAddress);
    if (!onChain.active) {
      throw fail(409, 'The smart contract does not list this wallet as an issuer yet. Approve it in MetaMask first.', 'not_on_chain');
    }
    return store.updateInstitution(id, { status: 'approved', approvedAt: new Date().toISOString(), approvedBy: actor });
  }

  /** Confirms a suspension the platform admin already signed in the contract. */
  async function suspend(id, actor) {
    const inst = await store.getInstitution(id);
    if (!inst) throw fail(404, 'Institution not found.');
    if (inst.walletAddress && (await chain.issuer(inst.walletAddress)).active) {
      throw fail(409, 'The smart contract still lists this wallet as active. Suspend it in MetaMask first.', 'not_on_chain');
    }
    return store.updateInstitution(id, { status: 'suspended', approvedBy: actor });
  }

  async function reject(id, actor) {
    const inst = await store.getInstitution(id);
    if (!inst) throw fail(404, 'Institution not found.');
    if (inst.status !== 'pending') throw fail(409, `Only pending institutions can be rejected (this one is ${inst.status}).`);
    return store.updateInstitution(id, { status: 'rejected', approvedBy: actor });
  }

  const publicView = ({ walletKeyEnc: _k, ...rest }) => rest;

  return { forUser, trustedByAddress, register, approve, suspend, reject, publicView };
}
