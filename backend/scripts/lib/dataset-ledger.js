// Builds the Karnataka dataset's chain in memory, for evaluations.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { addressOf } from '../../blockchain/index.js';
import { createLedger, createMemoryLedgerStore, deriveValidatorKeys } from '../../server/ledger.js';
import { marksString } from '../../../src/lib/certificateView.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const groupByEnrollment = (rows) => {
  const map = new Map();
  for (const r of rows) map.set(r.enrollment_id, [...(map.get(r.enrollment_id) ?? []), r]);
  return map;
};
export const loadData = (n) => JSON.parse(fs.readFileSync(path.join(here, '..', '..', 'data', 'karnataka', `${n}.json`), 'utf8'));

export async function buildDatasetLedger(log = () => {}) {
  const certs = loadData('degree_certificates');
  const univ = new Map(loadData('universities').map((u) => [u.univ_id, u.univ_name]));
  const keyFor = (name) => `0x${crypto.createHash('sha256').update(`eval-${name}`).digest('hex')}`;
  const authorityKey = keyFor('authority');
  const ledger = createLedger({
    ledgerStore: createMemoryLedgerStore(),
    authorityKey,
    validatorKeys: deriveValidatorKeys('eval'),
    chainName: 'Evaluation',
    rootIssuerName: 'Platform',
  });
  const authority = ledger.bridge(authorityKey);
  const semesters = groupByEnrollment(loadData('semester_results'));
  const enrollments = new Map(loadData('enrollments').map((e) => [e.enrollment_id, e]));
  const marksHashOf = (d) => crypto.createHash('sha256').update(marksString(semesters.get(d.enrollment_id) ?? [])).digest('hex');
  const certNo = (d) => d.certificate_serial_no || d.provisional_cert_no;
  const credentialIdOf = (d) => certNo(d).replace(/\//g, '-');

  log('Building the chain from the dataset...');
  const started = Date.now();
  const records = new Map();
  const issuers = new Map();
  for (const [id, name] of univ) {
    issuers.set(addressOf(keyFor(id)).toLowerCase(), { name });
    await authority.setIssuer(addressOf(keyFor(id)), name, true);
    const mine = certs.filter((d) => d.univ_id === id);
    const bridge = ledger.bridge(keyFor(id));
    await bridge.issueMany(
      mine.map((d) => ({ credentialId: credentialIdOf(d), certNo: certNo(d), certHash: d.sha256_hash, marksHash: marksHashOf(d) }))
    );
    const bad = mine.filter((d) => ['REVOKED', 'WITHHELD', 'CANCELLED_DUPLICATE_ISSUED'].includes(d.certificate_status));
    await bridge.revokeMany(bad.map((d) => ({ credentialId: credentialIdOf(d), reason: d.revocation_reason })));
    for (const d of mine) {
      const row = { ...d, credential_id: credentialIdOf(d), university: name };
      for (const k of [d.certificate_serial_no, d.provisional_cert_no, d.canonical_string.split('|')[0]]) {
        if (k) records.set(k.toLowerCase(), row);
      }
    }
  }
  const summary = await ledger.explorer.summary();
  log(`Chain: ${summary.blocks} blocks, ${summary.transactions} transactions, ${summary.certificates} certificates (${Date.now() - started} ms)\n`);

  const prefixes = loadData('universities').map((u) => u.short_code);
  const deps = {
    findDegree: async (no) => records.get(String(no).toLowerCase()) ?? null,
    findCredential: async () => null,
    ledgerGet: (id) => authority.getById(id),
    issuerTrusted: async (a) => issuers.get(a.toLowerCase()) ?? null,
    knownPrefixes: async () => prefixes,
    proof: (tx) => ledger.explorer.inclusionProof(tx),
    findMarks: async (id) => semesters.get(id) ?? null,
  };
  return { ledger, summary, deps, records, certs, semesters, enrollments, authority };
}
