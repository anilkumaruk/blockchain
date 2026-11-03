// Runs the dataset's 666 labelled verification requests through the real
// verifier against the real CredentialRegistry contract (Hardhat's in-process
// Ethereum, built from the dataset exactly as the import does), and reports accuracy.
//   npm run chain:evaluate

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDatasetChain } from './lib/dataset-chain.js';
import { verifyCertificateEvidence } from '../server/photoVerify.js';
import { qrPayload } from '../../src/lib/certificateView.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const load = (n) => JSON.parse(fs.readFileSync(path.join(here, '..', 'data', 'karnataka', `${n}.json`), 'utf8'));
const requests = load('verification_requests');

const { summary, deps, records } = await buildDatasetChain((m) => console.log(m));

// The dataset's QR codes carry its own SHA-256 of the canonical line. A QR that
// matches it is the genuine QR, which in this system carries the document hash
// recorded in the contract; any other QR hash stays a forgery.
const qrHashFor = (r) => {
  const d = records.get(String(r.claimed_certificate_no ?? '').toLowerCase());
  return d && r.qr_hash_on_document === d.sha256_hash ? d.record.hash.slice(2) : r.qr_hash_on_document;
};

// A request is what someone claims a certificate says, written as its printed rows.
const asText = (r) =>
  [
    ['Certificate No', r.claimed_certificate_no],
    ['University', r.claimed_university],
    ['Register No', r.claimed_reg_no],
    ['Name', r.claimed_name],
    ['Date of Birth', r.claimed_dob],
    ['Degree', r.claimed_degree],
    ['Branch', r.claimed_branch],
    ['CGPA or Percentage', r.claimed_cgpa_or_percent],
    ['Year of Passing', r.claimed_year_of_passing],
  ].filter(([, v]) => v != null).map(([l, v]) => `${l}: ${v}`).join('\n');

// The user-facing outcome expected for each dataset label.
const REVOKED_REASONS = /revoked|withheld|Original serial cancelled/i;
const expectedVerdict = (r) => {
  if (r.expected_result.startsWith('VALID')) return 'valid';
  return REVOKED_REASONS.test(r.failure_reason ?? '') ? 'revoked' : 'invalid';
};

const LABELS = ['valid', 'invalid', 'revoked'];
const matrix = Object.fromEntries(LABELS.map((a) => [a, Object.fromEntries(LABELS.map((b) => [b, 0]))]));
const byReason = new Map();
const failures = [];
const started = Date.now();
for (const r of requests) {
  const qrText = r.qr_hash_on_document && r.claimed_certificate_no ? qrPayload(r.claimed_certificate_no, qrHashFor(r)) : '';
  const out = await verifyCertificateEvidence({ ocrText: asText(r), qrText }, deps);
  const want = expectedVerdict(r);
  matrix[want][out.verdict] += 1;
  const reason = r.failure_reason ?? r.expected_result;
  const row = byReason.get(reason) ?? { want, total: 0, correct: 0 };
  row.total += 1;
  if (out.verdict === want) row.correct += 1;
  else failures.push({ id: r.request_id, reason, want, got: out.verdict, code: out.code, why: out.reason });
  byReason.set(reason, row);
}
const correct = LABELS.reduce((n, l) => n + matrix[l][l], 0);
const ms = (Date.now() - started) / requests.length;

const lines = [
  '# Verification evaluation: 666 labelled requests',
  '',
  `Generated ${new Date().toISOString()} by \`npm run chain:evaluate\`.`,
  `Contract used: CredentialRegistry on Hardhat's in-process Ethereum, ${summary.batchCount} Merkle batches (one per university), ${summary.totalIssued} certificates, ${summary.totalRevoked} revoked.`,
  'Input: each request\'s claimed details as text, and its QR hash (a QR matching the dataset\'s own hash is treated as the genuine QR). These cases test the verifier and the contract; OCR is measured separately in photo-ocr.md.',
  '',
  `**Accuracy: ${correct}/${requests.length} (${((correct / requests.length) * 100).toFixed(2)}%)**, ${ms.toFixed(2)} ms per verification.`,
  '',
  '| Expected \\ Result | valid | invalid | revoked |',
  '|---|---:|---:|---:|',
  ...LABELS.map((l) => `| ${l} | ${matrix[l].valid} | ${matrix[l].invalid} | ${matrix[l].revoked} |`),
  '',
  '| Case | Expected | Correct |',
  '|---|---|---:|',
  ...[...byReason.entries()].map(([reason, v]) => `| ${reason} | ${v.want} | ${v.correct}/${v.total} |`),
  '',
];
fs.mkdirSync(path.join(here, '..', 'results'), { recursive: true });
fs.writeFileSync(path.join(here, '..', 'results', 'verification-evaluation.md'), lines.join('\n'));
console.log(lines.slice(4).join('\n'));
if (failures.length) console.log('First failures:', JSON.stringify(failures.slice(0, 12), null, 1));
