// Tests that verify the upload-based verification flow:
//   1. The correct "canonical hash" (documentHash of the pipe-delimited string) is what
//      gets stored on-chain and must be used for verification — NOT the raw file bytes SHA-256.
//   2. QR-extracted hashes (which carry the canonical hash) work correctly.
//   3. Raw file-byte hashes always produce hash_mismatch (the core bug being fixed).
//   4. Batch credentials are verifiable by their canonical hash.
//   5. 0x prefix normalisation works both ways.
//   6. The photo-verify path now handles unreadable header fields (hash matches) → VALID.
//   7. The photo-verify path still rejects unreadable semester rows → INVALID.

import crypto from 'node:crypto';
import { expect } from 'chai';
import hre from 'hardhat';
import request from 'supertest';
import { buildApp, deployRegistry, login, seededStore, signers, university } from './helpers.js';
import { documentHash } from '../server/hash.js';
import { issuedCanonical, degreeCanonical, parseQrPayload, verifyUrl } from '../../src/lib/certificateView.js';
import { buildMerkleTree, leafOf } from '../server/merkle.js';
import { verifyCertificateEvidence } from '../server/photoVerify.js';

const { ethers } = hre;

// ---------------------------------------------------------------------------
// Shared credential fixture
// ---------------------------------------------------------------------------
const STUDENT = {
  studentName: 'Ananya Sharma',
  studentId: 'RGIT21CS014',
  credentialType: 'B.Tech in Computer Science & Engineering',
  issueDate: '2026-06-15',
};

// ---------------------------------------------------------------------------
// describe: Canonical hash vs raw-file hash
// ---------------------------------------------------------------------------
describe('Upload verification — canonical hash is what is stored on-chain', () => {
  let registry, app, uni, registrar, issued;

  beforeEach(async () => {
    [, registrar] = await signers();
    registry = await deployRegistry();
    app = await buildApp(registry);
    const token = await login(app, 'registrar.admin', 'admin12345');
    uni = university(app, token, registrar, registry);
    const res = await uni.issue(STUDENT);
    expect(res.status, JSON.stringify(res.body)).to.equal(201);
    issued = res.body;
  });

  it('verifies an individual credential by its canonical documentHash', async () => {
    // The canonical hash is exactly what the backend computes and stores on-chain.
    const canonical = issuedCanonical(issued.record);
    const canonicalHash = documentHash(canonical);

    // Must equal the hash the issuance returned
    expect(canonicalHash).to.equal(issued.hash);

    const res = await request(app).post('/api/verify/hash').send({ hash: canonicalHash });
    expect(res.status).to.equal(200);
    expect(res.body.status).to.equal('valid');
    expect(res.body.details.studentName).to.equal('Ananya Sharma');
  });

  it('rejects a raw-file-bytes SHA-256 that is not the canonical hash', async () => {
    // Simulate what the browser does when it computes crypto.subtle.digest('SHA-256', fileBytes).
    // The file content is arbitrary bytes — NOT the canonical pipe-delimited string.
    const fakeFileBytesHash = '0x' + crypto.createHash('sha256').update('arbitrary PDF bytes for ananya').digest('hex');

    // This hash was never stored on-chain → must be invalid
    const res = await request(app).post('/api/verify/hash').send({ hash: fakeFileBytesHash });
    expect(res.status).to.equal(200);
    expect(res.body.status).to.equal('invalid');
    expect(res.body.code).to.equal('hash_mismatch');
  });

  it('verifies with hash given without 0x prefix (normalisation)', async () => {
    const hashWithout0x = issued.hash.replace(/^0x/, '');
    const res = await request(app).post('/api/verify/hash').send({ hash: hashWithout0x });
    expect(res.status).to.equal(200);
    expect(res.body.status).to.equal('valid');
  });

  it('verifies with hash given in uppercase (normalisation)', async () => {
    const upperHash = issued.hash.toUpperCase();
    const res = await request(app).post('/api/verify/hash').send({ hash: upperHash });
    expect(res.status).to.equal(200);
    expect(res.body.status).to.equal('valid');
  });

  it('a QR-extracted canonical hash verifies correctly (simulates upload-tab QR scan)', async () => {
    // The QR code on a certificate image embeds the canonical hash (without 0x).
    // The UploadTab now extracts this and uses it for verification instead of raw file bytes.
    const qrHashHex = issued.hash.replace(/^0x/, ''); // 64 hex chars, no prefix
    const qrPayload = `COR1|${issued.credentialId}|${qrHashHex}`;
    const parsed = parseQrPayload(qrPayload);

    expect(parsed).to.not.equal(null);
    expect(parsed.hash).to.equal(qrHashHex);
    expect(parsed.certificateNo).to.equal(issued.credentialId);

    // Verify using the hash from the QR (as the fixed UploadTab now does)
    const res = await request(app).post('/api/verify/hash').send({ hash: `0x${parsed.hash}` });
    expect(res.status).to.equal(200);
    expect(res.body.status).to.equal('valid');
  });

  it('a QR URL payload verifies correctly', async () => {
    // verifyUrl format: https://origin/verify?credentialId=...&h=hash64hex
    const hash64 = issued.hash.replace(/^0x/, '');
    const qrUrl = verifyUrl('https://chain-of-record.test', issued.credentialId, hash64);
    const parsed = parseQrPayload(qrUrl);

    expect(parsed).to.not.equal(null);
    expect(parsed.hash).to.equal(hash64);

    const res = await request(app).post('/api/verify/hash').send({ hash: `0x${parsed.hash}` });
    expect(res.status).to.equal(200);
    expect(res.body.status).to.equal('valid');
  });
});

// ---------------------------------------------------------------------------
// describe: Batch credentials — canonical hash verification
// ---------------------------------------------------------------------------
describe('Upload verification — batch credentials verified by canonical hash', () => {
  const DEGREE = {
    canonical_string: 'AU/BC/2024/000010|R10|RAMESH KUMAR|2000-06-15|AU-BE-EE|7.50|2024|AU',
    reg_no: 'R10', candidate_name: 'RAMESH KUMAR', dob: '2000-06-15', cgpa_or_percent: 7.5, year_of_passing: 2024,
    certificate_serial_no: 'AU/BC/2024/000010', credential_id: 'AU-BC-2024-000010', enrollment_id: 'E10',
    certificate_status: 'ISSUED', degree_name: 'B.E.', branch: 'EE', university: 'Alliance University',
  };
  const DEGREE2 = {
    canonical_string: 'AU/BC/2024/000011|R11|PRIYA NAIR|2001-03-22|AU-BE-ME|8.20|2024|AU',
    reg_no: 'R11', candidate_name: 'PRIYA NAIR', dob: '2001-03-22', cgpa_or_percent: 8.2, year_of_passing: 2024,
    certificate_serial_no: 'AU/BC/2024/000011', credential_id: 'AU-BC-2024-000011', enrollment_id: 'E11',
    certificate_status: 'ISSUED', degree_name: 'B.E.', branch: 'ME', university: 'Alliance University',
  };

  let registry, app, store, registrar;

  beforeEach(async () => {
    [, registrar] = await signers();
    registry = await deployRegistry();
    store = await seededStore();

    store.addDegreeRecord(DEGREE);
    store.addDegreeRecord(DEGREE2);

    const hash1 = documentHash(degreeCanonical(DEGREE), []);
    const hash2 = documentHash(degreeCanonical(DEGREE2), []);
    const leaf1 = leafOf(DEGREE.credential_id, hash1);
    const leaf2 = leafOf(DEGREE2.credential_id, hash2);
    const tree = buildMerkleTree([leaf1, leaf2]);

    const tx = await (await registry.connect(registrar).anchorBatch(tree.root, 2)).wait();

    for (const [i, { degree, hash }] of [[0, { degree: DEGREE, hash: hash1 }], [1, { degree: DEGREE2, hash: hash2 }]]) {
      await store.insert({
        credentialId: degree.credential_id,
        certificateNo: degree.certificate_serial_no,
        studentName: degree.candidate_name,
        studentId: `S${i + 10}`,
        credentialType: `B.E. in ${degree.branch}`,
        issueDate: '2024-07-01',
        issuer: 'Alliance University',
        txHash: tx.hash,
        hash,
        status: 'valid',
        institutionId: 'alliance-university',
        issuerAddress: registrar.address,
        batch: { batchId: 1, root: tree.root, proof: tree.proof(i), index: i },
        chain: { mode: 'batch', txHash: tx.hash, blockNumber: tx.blockNumber },
      });
    }

    app = await buildApp(registry, { store });
  });

  it('verifies the first batch credential by its canonical hash', async () => {
    const hash = documentHash(degreeCanonical(DEGREE), []);
    const res = await request(app).post('/api/verify/hash').send({ hash });
    expect(res.status).to.equal(200);
    expect(res.body.status, JSON.stringify(res.body)).to.equal('valid');
    expect(res.body.details.onChain.proof.merkleProofValid).to.equal(true);
  });

  it('verifies the second batch credential by its canonical hash', async () => {
    const hash = documentHash(degreeCanonical(DEGREE2), []);
    const res = await request(app).post('/api/verify/hash').send({ hash });
    expect(res.status).to.equal(200);
    expect(res.body.status, JSON.stringify(res.body)).to.equal('valid');
    expect(res.body.details.onChain.proof.merkleProofValid).to.equal(true);
  });

  it('rejects a raw-file-byte hash for a batch credential', async () => {
    const fakeHash = '0x' + crypto.createHash('sha256').update('raw image bytes').digest('hex');
    const res = await request(app).post('/api/verify/hash').send({ hash: fakeHash });
    expect(res.status).to.equal(200);
    expect(res.body.status).to.equal('invalid');
    expect(res.body.code).to.equal('hash_mismatch');
  });
});

// ---------------------------------------------------------------------------
// describe: Photo verify — new hash-first logic for unreadable header fields
// ---------------------------------------------------------------------------

const ROWS = [
  { semester: 1, credits_earned: 20, sgpa: 7.38, result: 'PASS', backlogs: 0 },
  { semester: 2, credits_earned: 20, sgpa: 8.1,  result: 'PASS', backlogs: 0 },
];
const DEGREE_PV = {
  canonical_string: 'AU/DC/2024/000001|R1|ASHA RAO|2003-01-02|AU-BE-CS|8.00|2024|AU',
  reg_no: 'R1', candidate_name: 'ASHA RAO', dob: '2003-01-02', cgpa_or_percent: 8, year_of_passing: 2024,
  certificate_serial_no: 'AU/DC/2024/000001', credential_id: 'AU-DC-2024-000001', enrollment_id: 'E1',
  certificate_status: 'ISSUED', degree_name: 'B.E.', branch: 'CS', university: 'Alliance University',
};
const HEADER_PV = 'Certificate No: AU/DC/2024/000001\nUniversity: Alliance University\nRegister No: R1\nStudent Name: ASHA RAO\nDate of Birth: 2003-01-02\nDegree: B.E.\nBranch: CS\nCGPA or Percentage: 8.00\nYear of Passing: 2024\n';
const CARD_PV = `${HEADER_PV}Sem 1 20 7.38 PASS 0\nSem 2 20 8.10 PASS 0\n`;

describe('Photo verify — unreadable fields with hash-first logic', () => {
  const docHash = documentHash(degreeCanonical(DEGREE_PV), ROWS);
  const chainAnswer = { docHash, status: 'valid', issuer: '0x1', proof: { blockNumber: 7 } };

  const deps = (over = {}) => ({
    findDegree: async () => DEGREE_PV,
    findCredential: async () => null,
    onChain: async () => chainAnswer,
    issuerTrusted: async () => ({ name: 'Alliance University' }),
    findMarks: async () => ROWS,
    ...over,
  });

  const check = (ocrText, over, qrText) => verifyCertificateEvidence({ ocrText, qrText }, deps(over));

  // ---- existing behaviour still correct ----

  it('is VALID for the genuine card (baseline)', async () => {
    const r = await check(CARD_PV);
    expect(r.verdict).to.equal('valid');
  });

  it('is INVALID when a semester row cannot be read (hash matches → still INVALID due to hidden edit risk)', async () => {
    // The OCR text has an unreadable SGPA for Semester 2.
    // Even though the DB hash matches the chain, unreadable semester rows are rejected
    // because the photo might be obscuring an edited grade.
    const r = await check(`${HEADER_PV}Sem 1 20 7.38 PASS 0\nSem 2 20 ~~~~ 0\n`);
    expect(r).to.include({ verdict: 'invalid', code: 'fields_unreadable' });
    expect(r.reason).to.match(/Semester 2 SGPA/);
  });

  it('is INVALID when ALL fields are unreadable', async () => {
    // OCR completely failed — cannot extract any certificate number to look up
    const r = await check('~~~~ ~~~~ ~~~~');
    expect(r.verdict).to.equal('invalid');
    // Will be not_on_chain or fields_unreadable, but NOT valid
    expect(r.verdict).to.not.equal('valid');
  });

  // ---- new behaviour: unreadable HEADER fields + hash matches → VALID ----

  it('is VALID when header text fields are unreadable but hash matches (new behaviour)', async () => {
    // Simulate a photo where the student name or date of birth region is blurry/unreadable
    // but all semester rows are legible. The hash check (DB → chain) proves the record is genuine.
    // Previously this would have returned 'invalid/fields_unreadable'; now it returns 'valid'.
    const ocrText =
      'Certificate No: AU/DC/2024/000001\n' +
      // name and dob lines are missing/unreadable in this OCR output
      'Degree: B.E.\nBranch: CS\nCGPA or Percentage: 8.00\nYear of Passing: 2024\n' +
      'University: Alliance University\nRegister No: R1\n' +
      'Sem 1 20 7.38 PASS 0\nSem 2 20 8.10 PASS 0\n';
    const r = await check(ocrText);
    // The certificate number is found, the hash matches the blockchain → genuine
    expect(r.verdict).to.equal('valid');
    expect(r.hash.match).to.equal(true);
  });

  it('is INVALID when hash does not match even if all visible header fields match', async () => {
    // The DB data matches the OCR, but the on-chain hash is different → DB was tampered
    const badChain = { ...chainAnswer, docHash: '0x' + 'aa'.repeat(32) };
    const r = await check(CARD_PV, { onChain: async () => badChain });
    expect(r).to.include({ verdict: 'invalid', code: 'hash_mismatch' });
  });

  it('is INVALID when a field is changed on the photo (mismatch wins over unread)', async () => {
    // A tampered SGPA (changed value) takes priority: verdict is field_mismatch
    const r = await check(CARD_PV.replace('8.10', '9.10'));
    expect(r).to.include({ verdict: 'invalid', code: 'field_mismatch' });
    expect(r.reason).to.match(/Semester 2 SGPA/);
  });

  it('is INVALID when hash mismatch and semester row is unreadable (hash check takes priority)', async () => {
    // Both: hash mismatch AND unreadable semester row.
    // With the new logic: unread.length > 0, then we check hash first.
    // Hash does NOT match → returns hash_mismatch (data was altered), not fields_unreadable.
    const badChain = { ...chainAnswer, docHash: '0x' + 'bb'.repeat(32) };
    const r = await check(
      `${HEADER_PV}Sem 1 20 7.38 PASS 0\nSem 2 20 ~~~~ 0\n`,
      { onChain: async () => badChain },
    );
    expect(r).to.include({ verdict: 'invalid', code: 'hash_mismatch' });
  });
});

