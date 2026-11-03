// Performance evaluation for Review 2: gas cost, transaction time,
// verification time, on-chain storage footprint and detection accuracy.
// Runs the real API + contract on Hardhat's in-process EVM (instant mining),
// so latencies measure our software stack, not public-network block times.
//
//   npm run benchmark            (N defaults to 50)
//   BENCH_N=200 npm run benchmark

import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import hre from 'hardhat';
import request from 'supertest';
import { createChainBridge } from '../server/chain.js';
import { createMemoryStore } from '../server/store.js';
import { createAuth } from '../server/auth.js';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/passwords.js';
import { buildCertificateBytes } from '../../src/lib/generateCertificatePdf.js';

const N = Number(process.env.BENCH_N || 50);
const GAS_PRICES_GWEI = { 'Ethereum L1 (~10 gwei)': 10, 'Low-fee L2 (~0.05 gwei)': 0.05 };

const stats = (xs) => {
  const sorted = [...xs].sort((a, b) => a - b);
  const avg = xs.reduce((a, b) => a + b, 0) / xs.length;
  const pct = (p) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
  return { avg, min: sorted[0], p50: pct(50), p95: pct(95), max: sorted.at(-1) };
};
const ms = (x) => `${x.toFixed(1)} ms`;
const timed = async (fn) => {
  const t0 = performance.now();
  const out = await fn();
  return [out, performance.now() - t0];
};

const registry = await hre.ethers.deployContract('CredentialRegistry', ['Alliance University']);
const deployReceipt = await registry.deploymentTransaction().wait();
const store = createMemoryStore();
await store.createUser({ username: 'admin', passwordHash: await hashPassword('bench-admin'), role: 'admin' });
const app = createApp({
  chain: createChainBridge(registry),
  store,
  auth: createAuth({ jwtSecret: 'bench', store }),
  institutionName: 'Alliance University',
  rateLimits: false,
});
const { token } = (
  await request(app).post('/api/auth/login').send({ username: 'admin', password: 'bench-admin' })
).body;
const auth = { Authorization: `Bearer ${token}` };

console.log(`Benchmarking with N=${N} credentials on the in-process Hardhat EVM...\n`);

// ---- issuance ---------------------------------------------------------------
const issued = [];
const issueMs = [];
const issueGas = [];
for (let i = 0; i < N; i++) {
  const [res, t] = await timed(() =>
    request(app)
      .post('/api/credentials')
      .set(auth)
      .send({
        studentName: `Student ${i}`,
        studentId: `AU24CS${String(i).padStart(4, '0')}`,
        credentialType: 'B.Tech in Computer Science & Engineering',
        issueDate: '2026-06-15',
      })
  );
  if (res.status !== 201) throw new Error(`Issue failed: ${JSON.stringify(res.body)}`);
  issued.push(res.body);
  issueMs.push(t);
  issueGas.push(Number(res.body.record.chain.gasUsed));
}

// ---- verification -----------------------------------------------------------
const verifyIdMs = [];
const verifyFileMs = [];
let truePositives = 0;
let trueNegatives = 0;
for (const c of issued) {
  const [byId, t1] = await timed(() => request(app).get(`/api/verify/${c.credentialId}`));
  verifyIdMs.push(t1);

  const pdf = Buffer.from(buildCertificateBytes(c.record));
  const [byFile, t2] = await timed(() =>
    request(app).post('/api/verify/file').set('Content-Type', 'application/pdf').send(pdf)
  );
  verifyFileMs.push(t2);
  if (byId.body.status === 'valid' && byFile.body.status === 'valid') truePositives++;

  // Tampered copy: flip one byte inside the student-name text.
  const forged = Buffer.from(pdf);
  forged[forged.indexOf('Student ') + 2] ^= 0x01;
  const tampered = await request(app).post('/api/verify/file').set('Content-Type', 'application/pdf').send(forged);
  if (tampered.body.status === 'invalid') trueNegatives++;
}

// ---- revocation ---------------------------------------------------------------
const revokeGas = [];
const revokeMs = [];
const toRevoke = issued.slice(0, Math.max(1, Math.floor(N / 5)));
let revokedDetected = 0;
for (const c of toRevoke) {
  const [res, t] = await timed(() =>
    request(app).post(`/api/credentials/${c.credentialId}/revoke`).set(auth).send({ reason: 'benchmark' })
  );
  revokeMs.push(t);
  revokeGas.push(Number(res.body.revocation.gasUsed));
  const v = await request(app).get(`/api/verify/${c.credentialId}`);
  if (v.body.status === 'revoked') revokedDetected++;
}

// ---- Merkle batch issuance ------------------------------------------------------
const BATCH_SIZES = [10, 50, 100, 250, 500];
const batchRows = [];
let batchOffset = 0;
for (const size of BATCH_SIZES) {
  const credentials = Array.from({ length: size }, (_, i) => ({
    credentialId: `COR-2026-M${String(batchOffset + i).padStart(6, '0')}`,
    studentName: `Batch Student ${batchOffset + i}`,
    studentId: `AU25CS${String(batchOffset + i).padStart(5, '0')}`,
    credentialType: 'B.Tech in Computer Science & Engineering',
    issueDate: '2026-06-15',
  }));
  batchOffset += size;
  const [res, t] = await timed(() => request(app).post('/api/credentials/batch').set(auth).send({ credentials }));
  if (res.status !== 201) throw new Error(`Batch failed: ${JSON.stringify(res.body)}`);

  // Spot-check that members of the batch verify.
  const sample = res.body.credentials[Math.floor(size / 2)].credentialId;
  const [v, vt] = await timed(() => request(app).get(`/api/verify/${sample}`));
  if (v.body.status !== 'valid') throw new Error(`Batch member ${sample} did not verify`);

  const gas = Number(res.body.gasUsed);
  batchRows.push({ size, gas, perCredential: gas / size, ms: t, verifyMs: vt, proofLen: Math.ceil(Math.log2(size)) });
}

// ---- storage footprint --------------------------------------------------------
// Credential struct packs into 3 slots (docHash | issuer+issuedAt | revokedAt+status)
// plus 1 slot in keyByHash: 4 x 32 bytes per credential, independent of file size.
const ON_CHAIN_BYTES = 4 * 32;
const pdfBytes = stats(issued.map((c) => buildCertificateBytes(c.record).length));

const gIssue = stats(issueGas);
const gRevoke = stats(revokeGas);
const costRows = Object.entries(GAS_PRICES_GWEI).map(
  ([label, gwei]) => `| ${label} | ${((gIssue.avg * gwei) / 1e9).toFixed(6)} ETH | ${((gRevoke.avg * gwei) / 1e9).toFixed(6)} ETH |`
);

const report = `# Chain of Record — Performance Evaluation

Generated: ${new Date().toISOString()}
Environment: Hardhat in-process EVM (instant mining), Node ${process.version}, N = ${N} credentials

## Gas usage

| Operation | Avg gas | Min | Max |
|---|---:|---:|---:|
| Deploy registry (one-time) | ${deployReceipt.gasUsed} | – | – |
| Issue credential | ${Math.round(gIssue.avg)} | ${gIssue.min} | ${gIssue.max} |
| Revoke credential | ${Math.round(gRevoke.avg)} | ${gRevoke.min} | ${gRevoke.max} |
| Verify (view call) | 0 (free) | – | – |

### Estimated cost per operation

| Network | Issue | Revoke |
|---|---:|---:|
${costRows.join('\n')}

## Merkle batch issuance

One transaction anchors one Merkle root; each credential keeps a proof off-chain.

| Batch size | Total gas | Gas per credential | vs individual | Proof length | API time | Verify member |
|---:|---:|---:|---:|---:|---:|---:|
${batchRows
  .map(
    (r) =>
      `| ${r.size} | ${r.gas} | ${Math.round(r.perCredential)} | ${((r.perCredential / gIssue.avg) * 100).toFixed(2)}% | ${r.proofLen} hashes | ${ms(r.ms)} | ${ms(r.verifyMs)} |`
  )
  .join('\n')}

## End-to-end API latency (local stack)

| Operation | Avg | p50 | p95 | Max |
|---|---:|---:|---:|---:|
| Issue (hash + tx + DB) | ${ms(stats(issueMs).avg)} | ${ms(stats(issueMs).p50)} | ${ms(stats(issueMs).p95)} | ${ms(stats(issueMs).max)} |
| Revoke | ${ms(stats(revokeMs).avg)} | ${ms(stats(revokeMs).p50)} | ${ms(stats(revokeMs).p95)} | ${ms(stats(revokeMs).max)} |
| Verify by credential ID | ${ms(stats(verifyIdMs).avg)} | ${ms(stats(verifyIdMs).p50)} | ${ms(stats(verifyIdMs).p95)} | ${ms(stats(verifyIdMs).max)} |
| Verify by PDF upload | ${ms(stats(verifyFileMs).avg)} | ${ms(stats(verifyFileMs).p50)} | ${ms(stats(verifyFileMs).p95)} | ${ms(stats(verifyFileMs).max)} |

On a public testnet, issue/revoke latency is dominated by block confirmation
(~12 s per block on Sepolia); verification stays a free read-only call.

## Storage footprint

| Item | Size |
|---|---:|
| On-chain per credential (individual) | ${ON_CHAIN_BYTES} bytes (4 storage slots, fixed) |
| On-chain per batch (any size) | 96 bytes (3 storage slots: root, issuer+time+count, root-used flag) |
| Certificate PDF (off-chain) | avg ${Math.round(pdfBytes.avg)} bytes |
| Personal data on-chain | none (name, student ID, course stay off-chain) |

## Detection accuracy

| Check | Result |
|---|---:|
| Genuine certificates verified as valid | ${truePositives}/${N} (${((truePositives / N) * 100).toFixed(1)}%) |
| Single-byte tampered PDFs rejected | ${trueNegatives}/${N} (${((trueNegatives / N) * 100).toFixed(1)}%) |
| Revoked credentials reported as revoked | ${revokedDetected}/${toRevoke.length} (${((revokedDetected / toRevoke.length) * 100).toFixed(1)}%) |
`;

const outDir = path.join(hre.config.paths.root, 'results');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'benchmark.md'), report);
console.log(report);
console.log(`Saved to ${path.join(outDir, 'benchmark.md')}`);
