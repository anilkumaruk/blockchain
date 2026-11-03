// Builds the Karnataka dataset into a CredentialRegistry on Hardhat's
// in-process Ethereum, exactly as the import does on Sepolia: one Merkle batch
// per university, signed by its own account, then revocations by the issuer.
// Run scripts that use it with `npx hardhat run`.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import hre from 'hardhat';
import { createChainBridge } from '../../server/chain.js';
import { documentHash } from '../../server/hash.js';
import { buildMerkleTree, leafOf } from '../../server/merkle.js';
import { normalizeReason } from '../../server/app.js';
import { chainIdOf, degreeCanonical } from '../../../src/lib/certificateView.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const loadData = (n) => JSON.parse(fs.readFileSync(path.join(here, '..', '..', 'data', 'karnataka', `${n}.json`), 'utf8'));
const groupByEnrollment = (rows) => {
  const map = new Map();
  for (const r of rows) map.set(r.enrollment_id, [...(map.get(r.enrollment_id) ?? []), r]);
  return map;
};
const certNo = (d) => d.certificate_serial_no || d.provisional_cert_no;

export async function buildDatasetChain(log = () => {}) {
  const started = Date.now();
  const certs = loadData('degree_certificates');
  const universities = loadData('universities');
  const semesters = groupByEnrollment(loadData('semester_results'));
  const [owner, ...accounts] = await hre.ethers.getSigners();
  if (accounts.length < universities.length) throw new Error('Not enough Hardhat accounts for the universities.');
  const registry = await hre.ethers.deployContract('CredentialRegistry', ['Evaluation platform']);
  await registry.setIssuer(owner.address, 'Evaluation platform', false);
  const chain = createChainBridge(registry);

  log('Building the dataset into the smart contract...');
  const records = new Map(); // any printed number -> degree row with its on-chain record
  const issuers = new Map();
  let revoked = 0;
  for (const [i, u] of universities.entries()) {
    const signer = accounts[i];
    issuers.set(signer.address.toLowerCase(), { name: u.univ_name });
    await registry.setIssuer(signer.address, u.univ_name, true);
    const mine = certs.filter((d) => d.univ_id === u.univ_id);
    if (!mine.length) continue;
    const hashes = mine.map((d) => documentHash(degreeCanonical(d), semesters.get(d.enrollment_id) ?? []));
    const ids = mine.map((d) => chainIdOf(certNo(d)));
    const tree = buildMerkleTree(mine.map((_, k) => leafOf(ids[k], hashes[k])));
    const receipt = await (await registry.connect(signer).anchorBatch(tree.root, mine.length)).wait();
    const batchId = Number(receipt.logs.map((l) => registry.interface.parseLog(l)).find((e) => e?.name === 'BatchAnchored').args.batchId);
    for (const [k, d] of mine.entries()) {
      const record = { credentialId: ids[k], hash: hashes[k], batch: { batchId, root: tree.root, proof: tree.proof(k) }, blockNumber: receipt.blockNumber };
      if (['REVOKED', 'WITHHELD', 'CANCELLED_DUPLICATE_ISSUED'].includes(d.certificate_status)) {
        const reason = normalizeReason(d.certificate_status === 'WITHHELD' ? `Withheld: ${d.revocation_reason}` : d.revocation_reason);
        await registry.connect(signer).revokeBatchCredential(batchId, ids[k], hashes[k], record.batch.proof, hre.ethers.id(reason));
        revoked++;
      }
      const row = { ...d, credential_id: ids[k], university: u.univ_name, record };
      for (const key of [d.certificate_serial_no, d.provisional_cert_no, d.canonical_string.split('|')[0]]) {
        if (key) records.set(key.toLowerCase(), row);
      }
    }
  }
  const stats = await chain.stats();
  const summary = { ...stats, revoked, blocks: await hre.ethers.provider.getBlockNumber(), ms: Date.now() - started };
  log(`Contract: ${stats.batchCount} Merkle batches, ${stats.totalIssued} certificates, ${stats.totalRevoked} revoked (${summary.ms} ms)\n`);

  const deps = {
    findDegree: async (no) => records.get(String(no).toLowerCase()) ?? null,
    findCredential: async () => null,
    onChain: async ({ degree }) => {
      const r = degree?.record;
      if (!r) return null;
      const view = await chain.verifyBatch({ batchId: r.batch.batchId, credentialId: r.credentialId, hash: r.hash, proof: r.batch.proof });
      return view && { ...view, docHash: view.hash, proof: { mode: 'merkle-batch', batchId: r.batch.batchId, blockNumber: r.blockNumber } };
    },
    issuerTrusted: async (a) => issuers.get(String(a).toLowerCase()) ?? null,
    knownPrefixes: async () => universities.map((u) => u.short_code),
    findMarks: async (id) => semesters.get(id) ?? null,
  };
  const enrollments = new Map(loadData('enrollments').map((e) => [e.enrollment_id, e]));
  return { registry, chain, summary, deps, records, certs, semesters, enrollments };
}
