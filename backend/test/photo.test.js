// Certificate photo -> VALID / INVALID / REVOKED, checked against the smart
// contract on Hardhat's in-process Ethereum. Also the IPFS encryption.

import { expect } from 'chai';
import hre from 'hardhat';
import request from 'supertest';
import { buildApp, deployRegistry, login, seededStore, signers } from './helpers.js';
import { buildMerkleTree, leafOf } from '../server/merkle.js';
import { documentHash } from '../server/hash.js';
import { decryptDocument, encryptDocument } from '../server/ipfs.js';
import { compareFields, extractCertificateNo, parseCertificateText, parseSemesterRows, prefixCandidates, verifyCertificateEvidence } from '../server/photoVerify.js';
import { chainIdOf, degreeCanonical, parseQrPayload, verifyUrl } from '../../src/lib/certificateView.js';

const { ethers } = hre;
const ROWS = [
  { semester: 1, credits_earned: 20, sgpa: 7.38, result: 'PASS', backlogs: 0 },
  { semester: 2, credits_earned: 20, sgpa: 8.1, result: 'PASS', backlogs: 0 },
];
const DEGREE = {
  canonical_string: 'AU/DC/2024/000001|R1|ASHA RAO|2003-01-02|AU-BE-CS|8.00|2024|AU',
  reg_no: 'R1', candidate_name: 'ASHA RAO', dob: '2003-01-02', cgpa_or_percent: 8, year_of_passing: 2024,
  certificate_serial_no: 'AU/DC/2024/000001', credential_id: 'AU-DC-2024-000001', enrollment_id: 'E1',
  certificate_status: 'ISSUED', degree_name: 'B.E.', branch: 'CS', university: 'Alliance University',
};
const HEADER = 'Certificate No: AU/DC/2024/000001\nUniversity: Alliance University\nRegister No: R1\nStudent Name: ASHA RAO\nDate of Birth: 2003-01-02\nDegree: B.E.\nBranch: CS\nCGPA or Percentage: 8.00\nYear of Passing: 2024\n';
const CARD = `${HEADER}Sem 1 20 7.38 PASS 0\nSem 2 20 8.10 PASS 0\n`;

describe('Reading a certificate photo', () => {
  const text = 'DEGREE CERTIFICATE\nCertificate No: VTU/DC/2O17/0000O5\nRegister No: 1BI15MC001\nName: AMOGH DESHPANDE\nDate of Birth: 1992-02-19\nDegree: MCA\nCGPA or Percentage: 7.02\nYear of Passing: 2017\n';
  const view = { name: 'AMOGH DESHPANDE', registerNo: '1BI15MC001', dob: '1992-02-19', degree: 'MCA', score: '7.02', year: '2017' };

  it('repairs common OCR digit errors in the certificate number', () => {
    expect(extractCertificateNo(text)).to.equal('VTU/DC/2017/000005');
  });
  it('reads two label/value pairs printed side by side, and semester rows', () => {
    const card = 'Student Name: ASHA RAO   Program: Undergraduate\nRegistration No: 1BI15  Batch: 2021-25\nSem 1  21  6.28  PASS  0  Verified\nSem 2 21 6,12 PASS 0 Verified\nCGPA or Percentage: 6.04 Total Credit Points: 168\n';
    expect(parseCertificateText(card)).to.include({ name: 'ASHA RAO', program: 'Undergraduate', registerNo: '1BI15', batch: '2021-25', score: '6.04', credits: '168' });
    const rows = parseSemesterRows(card);
    expect(rows.get(1)).to.deep.equal({ credits: 21, sgpa: 6.28, readings: [6.28] });
    expect(rows.get(2).sgpa).to.equal(6.12);
  });
  it('suggests the closest university code for a misread prefix', () => {
    expect(prefixCandidates('lISc/DC/2020/000586', ['IISc', 'VTU', 'BU'])).to.deep.equal(['IISc/DC/2020/000586']);
    expect(prefixCandidates('XYZQ/DC/2020/000586', ['IISc', 'VTU', 'BU'])).to.deep.equal([]);
  });
  it('tolerates OCR noise in names but not edited numbers', () => {
    const parsed = parseCertificateText(text);
    expect(compareFields(view, parsed).every((f) => f.match)).to.equal(true);
    expect(compareFields(view, { ...parsed, name: 'AMOGH DESHPANOE' }).every((f) => f.match)).to.equal(true);
    const failed = (p) => compareFields(view, { ...parsed, ...p }).filter((f) => !f.match).map((f) => f.field);
    expect(failed({ name: 'ROHIT KUMAR SHARMA' })).to.deep.equal(['name']);
    expect(failed({ score: '9.02' })).to.deep.equal(['score']);
    expect(failed({ year: '2015' })).to.deep.equal(['year']);
    expect(failed({ dob: '1992-02-18' })).to.deep.equal(['dob']);
  });
  it('reads the QR link on a marks card, with the IPFS key after "#"', () => {
    const link = verifyUrl('https://x.test', 'AU/DC/2024/000001', 'a'.repeat(64), { cid: 'bafyTEST', key: 'b'.repeat(64) });
    expect(parseQrPayload(link)).to.deep.equal({ certificateNo: 'AU/DC/2024/000001', hash: 'a'.repeat(64), ipfs: { cid: 'bafyTEST', key: 'b'.repeat(64) } });
    expect(parseQrPayload('https://x.test/verify?credentialId=U1')).to.equal(null);
  });
});

describe('Photo verdicts (unit)', () => {
  const docHash = documentHash(degreeCanonical(DEGREE), ROWS);
  const chainAnswer = { docHash, status: 'valid', issuer: '0x1', proof: { blockNumber: 7 } };
  const deps = (over = {}) => ({
    findDegree: async () => DEGREE,
    findCredential: async () => null,
    onChain: async () => chainAnswer,
    issuerTrusted: async () => ({ name: 'Alliance University' }),
    findMarks: async () => ROWS,
    ...over,
  });
  const check = (ocrText, over, qrText) => verifyCertificateEvidence({ ocrText, qrText }, deps(over));

  it('is VALID for the genuine card', async () => {
    expect((await check(CARD)).verdict).to.equal('valid');
  });
  it('is INVALID when the contract has no such certificate', async () => {
    expect(await check(CARD, { onChain: async () => null })).to.include({ verdict: 'invalid', code: 'not_on_chain' });
  });
  it('is INVALID for an edited SGPA, naming the semester', async () => {
    const r = await check(CARD.replace('8.10', '9.10'));
    expect(r).to.include({ verdict: 'invalid', code: 'field_mismatch' });
    expect(r.reason).to.match(/Semester 2 SGPA/);
  });
  it('is INVALID when the marks were changed in the database', async () => {
    const edited = ROWS.map((r) => (r.semester === 2 ? { ...r, sgpa: 9.1 } : r));
    const r = await check(CARD.replace('8.10', '9.10'), { findMarks: async () => edited });
    expect(r).to.include({ verdict: 'invalid', code: 'hash_mismatch' });
  });
  it('is INVALID when the issuer is not trusted', async () => {
    expect(await check(CARD, { issuerTrusted: async () => null })).to.include({ verdict: 'invalid', code: 'untrusted_issuer' });
  });
  it('is INVALID, not VALID, when a semester row cannot be read', async () => {
    expect(await check(`${HEADER}Sem 1 20 7.38 PASS 0\nSem 2 20 ~~~~ 0\n`)).to.include({ verdict: 'invalid', code: 'fields_unreadable' });
  });
  it("is INVALID when the QR code's hash differs from the contract", async () => {
    const qr = verifyUrl('https://x.test', 'AU/DC/2024/000001', 'b'.repeat(64));
    expect(await check(CARD, {}, qr)).to.include({ verdict: 'invalid', code: 'qr_hash_mismatch' });
  });
  it('is REVOKED when the contract says so', async () => {
    expect((await check(CARD, { onChain: async () => ({ ...chainAnswer, status: 'revoked' }) })).verdict).to.equal('revoked');
  });
});

describe('Photo verification against the smart contract (API)', () => {
  let registry, app, store, registrar;

  beforeEach(async () => {
    [, registrar] = await signers();
    registry = await deployRegistry();
    store = await seededStore();
    // A registry certificate, anchored in a Merkle batch by Alliance University's wallet.
    store.addDegreeRecord(DEGREE);
    store.addMarks('E1', { semesters: ROWS });
    const hash = documentHash(degreeCanonical(DEGREE), ROWS);
    const tree = buildMerkleTree([leafOf(DEGREE.credential_id, hash), leafOf('AU-DC-2024-000002', `0x${'22'.repeat(32)}`)]);
    const tx = await (await registry.connect(registrar).anchorBatch(tree.root, 2)).wait();
    await store.insert({
      credentialId: DEGREE.credential_id, certificateNo: DEGREE.certificate_serial_no, studentName: 'ASHA RAO', studentId: 'S1',
      credentialType: 'B.E. in CS', issueDate: '2024-07-01', issuer: 'Alliance University', txHash: tx.hash, hash, status: 'valid',
      institutionId: 'alliance-university', issuerAddress: registrar.address,
      batch: { batchId: 1, root: tree.root, proof: tree.proof(0), index: 0 },
      chain: { mode: 'batch', txHash: tx.hash, blockNumber: tx.blockNumber },
    });
    app = await buildApp(registry, { store });
  });

  it('is VALID for a genuine photo, with the block and Merkle proof', async () => {
    const res = await request(app).post('/api/verify/photo').send({ ocrText: CARD });
    expect(res.body.verdict, JSON.stringify(res.body)).to.equal('valid');
    expect(res.body.proof).to.include({ mode: 'merkle-batch', batchId: 1, merkleProofValid: true });
    expect(res.body.proof.blockNumber).to.be.a('number');
    expect(res.body.proof.confirmations).to.be.at.least(1);
    expect(res.body.hash.match).to.equal(true);
  });

  it('is INVALID for a forged CGPA and for an unknown number', async () => {
    expect((await request(app).post('/api/verify/photo').send({ ocrText: CARD.replace('CGPA or Percentage: 8.00', 'CGPA or Percentage: 9.00') })).body.code).to.equal('field_mismatch');
    expect((await request(app).post('/api/verify/photo').send({ ocrText: CARD.replaceAll('000001', '999999') })).body.code).to.equal('not_on_chain');
  });

  it('is REVOKED once the university revokes it in the contract', async () => {
    const record = await store.get(DEGREE.credential_id);
    await (
      await registry.connect(registrar).revokeBatchCredential(1, record.credentialId, record.hash, record.batch.proof, ethers.id('Malpractice'))
    ).wait();
    await store.update(record.credentialId, { status: 'revoked', revocation: { reason: 'Malpractice' } });
    const res = await request(app).post('/api/verify/photo').send({ ocrText: CARD });
    expect(res.body.verdict).to.equal('revoked');
  });

  it('gives the student a marks card whose hash matches the contract', async () => {
    await store.createUser({ username: 'asha', passwordHash: (await store.getUser('ananya')).passwordHash, role: 'student', studentId: 'S1' });
    store.addDegreeRecord({ ...DEGREE, student_id: 'S1' });
    const token = await login(app, 'asha', 'student12345');
    const cards = (await request(app).get('/api/me/certificates').set('Authorization', `Bearer ${token}`)).body;
    expect(cards[0]).to.include({ status: 'valid', marksVerified: true });
    expect(`0x${cards[0].hash}`).to.equal((await store.get(DEGREE.credential_id)).hash);
    expect(chainIdOf(cards[0].view.certificateNo)).to.equal(DEGREE.credential_id);
  });
});

describe('IPFS document encryption', () => {
  it('round-trips, and fails with the wrong key or edited bytes', () => {
    const doc = { canonical: 'X|Y', semesters: ROWS };
    const { bytes, key } = encryptDocument(doc);
    expect(decryptDocument(bytes, key)).to.deep.equal(doc);
    expect(() => decryptDocument(bytes, 'ab'.repeat(32))).to.throw();
    const edited = Buffer.from(bytes);
    edited[20] ^= 1;
    expect(() => decryptDocument(edited, key)).to.throw();
    expect(bytes.toString('latin1')).to.not.include('X|Y'); // ciphertext only
  });

  it('pins the encrypted document through the Pinata API and returns its CID', async () => {
    const { createIpfs } = await import('../server/ipfs.js');
    let sent = null;
    const ipfs = createIpfs({
      jwt: 'test-jwt',
      fetchImpl: async (url, init) => {
        sent = { url, auth: init.headers.Authorization, file: init.body.get('file') };
        return new Response(JSON.stringify({ IpfsHash: 'bafyFAKECID' }), { status: 200 });
      },
    });
    const pinned = await ipfs.pinEncrypted({ canonical: 'A' }, 'COR-1');
    expect(pinned.cid).to.equal('bafyFAKECID');
    expect(sent.url).to.match(/pinata/);
    expect(sent.auth).to.equal('Bearer test-jwt');
    expect(decryptDocument(Buffer.from(await sent.file.arrayBuffer()), pinned.key)).to.deep.equal({ canonical: 'A' });
    expect(createIpfs({})).to.equal(null); // no JWT: IPFS is simply not used
  });
});
