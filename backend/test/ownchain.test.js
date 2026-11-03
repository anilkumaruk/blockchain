// The project's own blockchain: block structure, linking, consensus, tampering.

import { expect } from 'chai';
import request from 'supertest';
import {
  BlockchainNetwork,
  addressOf,
  createTransaction,
  hashHeader,
  merkleProof,
  merkleRoot,
  mine,
  replayChain,
  sha256,
  verifyMerkleProof,
} from '../blockchain/index.js';
import { createLedger, createMemoryLedgerStore, deriveValidatorKeys } from '../server/ledger.js';
import { createApp } from '../server/app.js';
import { createAuth } from '../server/auth.js';
import { createMemoryStore } from '../server/store.js';
import { hashPassword } from '../server/passwords.js';
import { compareFields, extractCertificateNo, parseCertificateText, parseSemesterRows, prefixCandidates, verifyCertificateEvidence } from '../server/photoVerify.js';
import { TEST_WALLET_KEY } from './helpers.js';
import { marksString, parseQrPayload, verifyUrl } from '../../src/lib/certificateView.js';
import { certificateSvg } from '../../src/lib/certificateSvg.js';

const key = (name) => `0x${sha256(`test-${name}`)}`;
const AUTHORITY = key('authority');
const UNI = key('uni');
const hash = (s) => sha256(s);

function buildNetwork() {
  const net = new BlockchainNetwork(deriveValidatorKeys('test'));
  const add = (...txs) => {
    const p = net.propose(txs);
    net.commit(p);
    return p.block;
  };
  add(net.genesisTransaction({ authorityKey: AUTHORITY, authorityName: 'Platform', chainName: 'Test', difficulty: 2 }));
  add(createTransaction('SET_ISSUER', { address: addressOf(UNI), name: 'Uni', active: true }, AUTHORITY));
  return { net, add };
}
const issue = (id) => createTransaction('ISSUE', { credentialId: id, certNo: `U/DC/2024/${id}`, certHash: hash(id) }, UNI);

describe('Own blockchain', () => {
  describe('Merkle tree', () => {
    const leaves = ['a', 'b', 'c', 'd', 'e'].map(sha256);
    it('proves every leaf with log2(n) hashes, and rejects wrong leaves', () => {
      const root = merkleRoot(leaves);
      leaves.forEach((leaf, i) => {
        const proof = merkleProof(leaves, i);
        expect(proof.length).to.be.at.most(3);
        expect(verifyMerkleProof(leaf, proof, root)).to.equal(true);
        expect(verifyMerkleProof(sha256('x'), proof, root)).to.equal(false);
      });
    });
    it('changes the root when any leaf changes', () => {
      const changed = [...leaves];
      changed[3] = sha256('tampered');
      expect(merkleRoot(changed)).to.not.equal(merkleRoot(leaves));
    });
  });

  describe('Blocks and linking', () => {
    it('links each block to the previous hash, starting from a zero hash', () => {
      const { net, add } = buildNetwork();
      add(issue('A'), issue('B'));
      const { blocks } = net.leader;
      expect(blocks[0].header.previousHash).to.equal('0'.repeat(64));
      blocks.slice(1).forEach((b, i) => expect(b.header.previousHash).to.equal(blocks[i].hash));
      blocks.forEach((b) => {
        expect(hashHeader(b.header)).to.equal(b.hash);
        expect(b.hash.startsWith('0'.repeat(b.header.difficulty))).to.equal(true);
      });
      expect(replayChain(blocks).valid).to.equal(true);
    });

    it('gives each node its own copy of every block', () => {
      const { net } = buildNetwork();
      expect(net.nodes[0].blocks[0]).to.not.equal(net.nodes[1].blocks[0]);
      expect(net.nodes[0].blocks[0]).to.deep.equal(net.nodes[1].blocks[0]);
    });

    it('rebuilds identical state by replay, including revocation', () => {
      const { net, add } = buildNetwork();
      add(issue('A'), issue('B'));
      add(createTransaction('REVOKE', { credentialId: 'B', reasonHash: hash('why') }, UNI));
      const { state } = replayChain(net.leader.blocks);
      expect(state.lookup('A').status).to.equal('valid');
      expect(state.lookup('B').status).to.equal('revoked');
      expect(state.lookup('B').events.map((e) => e.type)).to.deep.equal(['issued', 'revoked']);
      expect(state.lookup('u/dc/2024/a').credentialId).to.equal('A');
    });
  });

  describe('Rules', () => {
    const rejects = (fn, reason) => expect(fn).to.throw().with.property('reason', reason);
    it('rejects duplicates, reused hashes, unauthorised issuers and double revocation', () => {
      const { net, add } = buildNetwork();
      add(issue('A'));
      rejects(() => net.propose([issue('A')]), 'CredentialAlreadyExists');
      rejects(() => net.propose([createTransaction('ISSUE', { credentialId: 'Z', certHash: hash('A') }, UNI)]), 'HashAlreadyRegistered');
      rejects(() => net.propose([createTransaction('ISSUE', { credentialId: 'Q', certHash: hash('Q') }, key('stranger'))]), 'NotAuthorizedIssuer');
      rejects(() => net.propose([createTransaction('SET_ISSUER', { address: addressOf(key('x')), active: true }, UNI)]), 'OwnableUnauthorizedAccount');
      add(createTransaction('REVOKE', { credentialId: 'A' }, UNI));
      rejects(() => net.propose([createTransaction('REVOKE', { credentialId: 'A' }, UNI)]), 'AlreadyRevoked');
    });
    it("lets only the original issuer revoke, and rejects a forged sender", () => {
      const { net, add } = buildNetwork();
      add(createTransaction('SET_ISSUER', { address: addressOf(key('other')), name: 'Other', active: true }, AUTHORITY));
      add(issue('A'));
      rejects(() => net.propose([createTransaction('REVOKE', { credentialId: 'A' }, key('other'))]), 'NotOriginalIssuer');
      const forged = { ...createTransaction('REVOKE', { credentialId: 'A' }, key('other')), from: addressOf(UNI) };
      expect(() => net.propose([forged])).to.throw();
    });
    it('rolls a whole block back when one transaction is bad', () => {
      const { net, add } = buildNetwork();
      add(issue('A'));
      expect(() => net.propose([issue('B'), issue('A')])).to.throw();
      expect(net.state.lookup('B')).to.equal(null);
    });
  });

  describe('Tampering', () => {
    function chainWithCerts() {
      const built = buildNetwork();
      built.add(issue('A'), issue('B'));
      built.add(issue('C'));
      built.add(issue('D'));
      return built;
    }
    it('detects an edited transaction, even without signature checks', () => {
      const { net } = chainWithCerts();
      const copy = structuredClone(net.leader.blocks);
      copy[2].transactions[0].payload.certHash = 'f'.repeat(64);
      const r = replayChain(copy, { deep: false });
      expect(r).to.include({ valid: false, invalidAt: 2, problem: 'transaction_data_altered' });
    });
    it('catches every escalation up to re-mining all later blocks', () => {
      const { net } = chainWithCerts();
      const copy = structuredClone(net.leader.blocks);
      const tx = copy[2].transactions[0];
      tx.payload.certHash = 'f'.repeat(64);
      tx.id = sha256('forged id');
      expect(replayChain(copy, { deep: false }).problem).to.equal('merkle_root_mismatch');
      copy[2].header.merkleRoot = merkleRoot(copy[2].transactions.map((t) => t.id));
      expect(replayChain(copy, { deep: false }).problem).to.equal('block_hash_mismatch');
    });
    it('rejects forged history: re-mined links still lack validator signatures', () => {
      const { net } = chainWithCerts();
      const copy = structuredClone(net.leader.blocks);
      const m = mine({ ...copy[2].header, timestamp: copy[2].header.timestamp + 1 });
      copy[2].header = m.header;
      copy[2].hash = m.hash;
      expect(replayChain(copy, { deep: false }).problem).to.equal('previous_hash_mismatch');
      for (let i = 3; i < copy.length; i++) {
        copy[i].header.previousHash = copy[i - 1].hash;
        const next = mine({ ...copy[i].header });
        copy[i].header = next.header;
        copy[i].hash = next.hash;
      }
      expect(replayChain(copy, { deep: false }).valid).to.equal(true); // hashes alone now link...
      expect(replayChain(copy, { deep: true }).problem).to.equal('not_enough_validator_signatures'); // ...votes do not
    });
    it('isolates a corrupted node, keeps working with 2 of 3, and repairs it', () => {
      const { net, add } = chainWithCerts();
      net.nodes[1].blocks[2].transactions[0].payload.certHash = 'f'.repeat(64);
      net.nodes[1].load(net.nodes[1].blocks);
      expect(net.nodes[1].integrity.valid).to.equal(false);
      add(issue('E'));
      expect(net.leader.state.lookup('E')).to.not.equal(null);
      expect(net.repair()).to.include('node-2');
      net.audit().forEach((a) => expect(a.valid, a.node).to.equal(true));
      expect(net.consensus().agreed).to.equal(true);
    });
    it('needs a majority: with two of three nodes offline no block is added', () => {
      const { net, add } = chainWithCerts();
      net.nodes[2].online = false;
      add(issue('E'));
      net.nodes[1].online = false;
      expect(() => net.propose([issue('F')])).to.throw('not enough validators');
    });
  });

  describe('Reading a certificate photo', () => {
    const text = `DEGREE CERTIFICATE\nCertificate No: VTU/DC/2O17/0000O5\nRegister No: 1BI15MC001\nName: AMOGH DESHPANDE\nDate of Birth: 1992-02-19\nDegree: MCA\nCGPA or Percentage: 7.02\nYear of Passing: 2017\n`;
    const view = { name: 'AMOGH DESHPANDE', registerNo: '1BI15MC001', dob: '1992-02-19', degree: 'MCA', score: '7.02', year: '2017' };
    it('repairs common OCR digit errors in the certificate number', () => {
      expect(extractCertificateNo(text)).to.equal('VTU/DC/2017/000005');
    });
    it('reads two label/value pairs printed side by side, and semester rows', () => {
      const card = 'Student Name: ASHA RAO   Program: Undergraduate\nRegistration No: 1BI15  Batch: 2021-25\nSem 1  21  6.28  PASS  0  Verified\nSem 2 21 6,12 PASS 0 Verified\nCGPA or Percentage: 6.04 Total Credit Points: 168\n';
      const parsed = parseCertificateText(card);
      expect(parsed).to.include({ name: 'ASHA RAO', program: 'Undergraduate', registerNo: '1BI15', batch: '2021-25', score: '6.04', credits: '168' });
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
  });

  describe('API', () => {
    let app, store, ledger, token, certificate;
    const PLACE = { studentName: 'Asha Rao', studentId: 'AU1', credentialType: 'B.Tech', issueDate: '2026-06-15', credentialId: 'COR-2026-AAA111' };
    const printed = (over = {}) => {
      const f = { ...PLACE, ...over };
      return `Certificate No: ${f.credentialId}\nUniversity: Test University\nRegister No: ${f.studentId}\nName: ${f.studentName}\nDegree: ${f.credentialType}\nYear of Passing: ${f.issueDate.slice(0, 4)}\n`;
    };
    const post = (body) => request(app).post('/api/verify/photo').send(body);

    before(async () => {
      store = createMemoryStore();
      ledger = createLedger({
        ledgerStore: createMemoryLedgerStore(),
        authorityKey: AUTHORITY,
        validatorKeys: deriveValidatorKeys('api'),
        chainName: 'Test',
        rootIssuerName: 'Test University',
        difficulty: 2,
      });
      await store.createInstitution({ id: 'test-university', name: 'Test University', status: 'approved', kind: 'university' });
      await store.createUser({ username: 'reg', passwordHash: await hashPassword('registrar1'), role: 'institution', institutionId: 'test-university' });
      await store.createUser({ username: 'platform', passwordHash: await hashPassword('platform1'), role: 'admin' });
      app = createApp({
        chain: ledger.bridge(AUTHORITY),
        connect: (k) => ledger.bridge(k),
        ledger,
        walletKey: TEST_WALLET_KEY,
        store,
        auth: createAuth({ jwtSecret: 'test-secret', store }),
        institutionName: 'Test University',
        rateLimits: false,
      });
      token = (await request(app).post('/api/auth/login').send({ username: 'reg', password: 'registrar1' })).body.token;
      certificate = await request(app).post('/api/credentials').set('Authorization', `Bearer ${token}`).send(PLACE);
    });

    it('issues on the chain and returns VALID for a matching photo, with a proof', async () => {
      expect(certificate.status, JSON.stringify(certificate.body)).to.equal(201);
      const res = await post({ ocrText: printed() });
      expect(res.body.verdict, JSON.stringify(res.body)).to.equal('valid');
      expect(res.body.proof.merkleProofValid).to.equal(true);
      expect(res.body.hash.match).to.equal(true);
    });
    it('returns INVALID for edited details and unknown numbers, naming the field', async () => {
      const edited = await post({ ocrText: printed({ studentName: 'Rohit Kumar' }) });
      expect(edited.body).to.include({ verdict: 'invalid', code: 'field_mismatch' });
      expect(edited.body.reason).to.match(/Name/);
      const unknown = await post({ ocrText: printed({ credentialId: 'COR-2026-ZZZ999' }) });
      expect(unknown.body).to.include({ verdict: 'invalid', code: 'not_on_chain' });
      const blank = await post({ ocrText: 'a holiday photo' });
      expect(blank.body).to.include({ verdict: 'invalid', code: 'unreadable' });
    });
    it('returns INVALID when the database record no longer hashes to the chain value', async () => {
      await store.update(PLACE.credentialId, { studentName: 'Asha R Rao' });
      const res = await post({ ocrText: printed({ studentName: 'Asha R Rao' }) });
      await store.update(PLACE.credentialId, { studentName: PLACE.studentName });
      expect(res.body).to.include({ verdict: 'invalid', code: 'hash_mismatch' });
    });
    it('returns REVOKED after revocation, with the history kept', async () => {
      await request(app).post(`/api/credentials/${PLACE.credentialId}/revoke`).set('Authorization', `Bearer ${token}`).send({ reason: 'Malpractice' }).expect(200);
      const res = await post({ ocrText: printed() });
      expect(res.body.verdict, JSON.stringify(res.body)).to.equal('revoked');
      expect(res.body.reason).to.match(/Malpractice/);
      const history = await request(app).get(`/api/credentials/${PLACE.credentialId}/history`);
      expect(history.body.events.map((e) => e.type)).to.deep.equal(['issued', 'revoked']);
    });
    it('exposes the blocks publicly, and validates them from scratch', async () => {
      const summary = (await request(app).get('/api/chain/summary').expect(200)).body;
      expect(summary.blocks).to.equal(3); // genesis, issue, revoke
      expect(summary.consensus.agreed).to.equal(true);
      const list = (await request(app).get('/api/chain/blocks').expect(200)).body;
      expect(list.blocks[0].previousHash).to.equal(list.blocks[1].hash);
      const block = (await request(app).get('/api/chain/blocks/1').expect(200)).body;
      expect(block).to.include({ headerHashValid: true, merkleRootValid: true, linkValid: true, powValid: true });
      expect(JSON.stringify(block)).to.not.include('Asha'); // no personal data on-chain
      const audit = (await request(app).get('/api/chain/audit').expect(200)).body;
      audit.forEach((n) => expect(n.valid, n.node).to.equal(true));
    });
    it('detects every step of the tamper simulation and leaves the real chain alone', async () => {
      const before_ = (await request(app).get('/api/chain/summary')).body.headHash;
      const res = (await request(app).post('/api/chain/simulate-tamper').send({ block: 1 }).expect(200)).body;
      expect(res.steps).to.have.length(4);
      res.steps.forEach((s) => expect(s.detected, s.attempt).to.equal(true));
      expect((await request(app).get('/api/chain/summary')).body.headHash).to.equal(before_);
    });
    it('asks every node and fails safe when no majority agrees', async () => {
      const ledgerStore = createMemoryLedgerStore();
      const options = { ledgerStore, authorityKey: AUTHORITY, validatorKeys: deriveValidatorKeys('m'), chainName: 'T', rootIssuerName: 'U', difficulty: 2 };
      await createLedger(options).bridge(AUTHORITY).issue('M-1', hash('m1'));
      const healthy = await createLedger(options).bridge(AUTHORITY).getById('M-1');
      expect(healthy.consensus).to.include({ agree: 3, total: 3 });

      ledgerStore.corrupt('node-2', 1, (b) => {
        b.transactions[0].payload.certHash = 'f'.repeat(64);
      });
      const oneBad = await createLedger(options).bridge(AUTHORITY).getById('M-1');
      expect(oneBad.consensus.agree).to.equal(2); // node-2's copy is rejected, the majority still answers
      expect(oneBad.certHash).to.equal(hash('m1'));

      ledgerStore.corrupt('node-3', 1, (b) => {
        b.transactions[0].payload.certHash = 'e'.repeat(64);
      });
      let error = null;
      await createLedger(options).bridge(AUTHORITY).getById('M-1').catch((e) => { error = e; });
      expect(error?.name).to.equal('ChainUnavailableError');
    });
    it('walks every link from the certificate block to the newest block', async () => {
      const res = await post({ ocrText: printed() });
      const walk = res.body.proof.chainWalk;
      expect(walk).to.include({ from: 1, valid: true, issuerSignatureValid: true, validatorSignaturesValid: true });
      expect(walk.to).to.be.greaterThan(walk.from);
      expect(walk.blocksChecked).to.equal(walk.to - walk.from + 1);
      expect(res.body.consensus).to.include({ agree: 3, total: 3 });
    });
    it('catches edited semester marks: read from the photo, or changed in the database', async () => {
      const rows = [{ semester: 1, credits_earned: 20, sgpa: 7.38, result: 'PASS', backlogs: 0 }, { semester: 2, credits_earned: 20, sgpa: 8.1, result: 'PASS', backlogs: 0 }];
      const marksHash = hash(marksString(rows));
      const canonical = 'U/DC/2024/000001|R1|ASHA RAO|2003-01-02|U-BE-CS|8.00|2024|U1';
      const degree = { canonical_string: canonical, reg_no: 'R1', candidate_name: 'ASHA RAO', dob: '2003-01-02', cgpa_or_percent: 8, year_of_passing: 2024, certificate_serial_no: 'U/DC/2024/000001', credential_id: 'U-1', enrollment_id: 'E1', certificate_status: 'ISSUED', degree_name: 'B.E.', branch: 'CS', university: 'Test University' };
      const onChain = { txId: 't', certHash: hash(canonical), marksHash, status: 'valid', issuer: '0x1', consensus: { agree: 3, total: 3 } };
      const deps = (marks) => ({
        findDegree: async () => degree, findCredential: async () => null, ledgerGet: async () => onChain,
        issuerTrusted: async () => ({ name: 'Test University' }), proof: async () => null, findMarks: async () => marks,
      });
      const card = (sgpa2) => `Certificate No: U/DC/2024/000001\nUniversity: Test University\nRegister No: R1\nStudent Name: ASHA RAO\nDate of Birth: 2003-01-02\nDegree: B.E.\nBranch: CS\nCGPA or Percentage: 8.00\nYear of Passing: 2024\nSem 1 20 7.38 PASS 0\nSem 2 20 ${sgpa2} PASS 0\n`;
      expect((await verifyCertificateEvidence({ ocrText: card('8.10') }, deps(rows))).verdict).to.equal('valid');
      const forged = await verifyCertificateEvidence({ ocrText: card('9.10') }, deps(rows));
      expect(forged).to.include({ verdict: 'invalid', code: 'field_mismatch' });
      expect(forged.reason).to.match(/Semester 2 SGPA/);
      const dbEdit = rows.map((r) => (r.semester === 2 ? { ...r, sgpa: 9.1 } : r));
      const edited = await verifyCertificateEvidence({ ocrText: card('9.10') }, deps(dbEdit));
      expect(edited).to.include({ verdict: 'invalid', code: 'marks_hash_mismatch' });
    });
    it('renders a marks card that reports revocation, not "Verified"', () => {
      const view = { title: 'MARKS CARD', certificateNo: 'U/DC/2024/000001', name: 'ASHA RAO', semesters: [{ semester: 1, credits_earned: 20, sgpa: 7.38, result: 'PASS', backlogs: 0 }] };
      const svg = (status, marksVerified) => certificateSvg({ view, hash: 'a'.repeat(64), txId: 'b'.repeat(64), status, marksVerified }, { origin: 'https://x.test' });
      expect(svg('valid', true)).to.include('Blockchain Verified').and.include('>Verified<');
      expect(svg('revoked', true)).to.include('REVOKED').and.not.include('Blockchain Verified');
      expect(svg('valid', false)).to.include('Unverified');
    });
    it('reads the QR link printed on a marks card', () => {
      const link = verifyUrl('https://x.test', 'U/DC/2024/000001', 'a'.repeat(64));
      expect(parseQrPayload(link)).to.deep.equal({ certificateNo: 'U/DC/2024/000001', hash: 'a'.repeat(64) });
      expect(parseQrPayload('https://x.test/verify?credentialId=U1')).to.equal(null);
    });
    it('notices a stored copy edited behind its back after a restart', async () => {
      const ledgerStore = createMemoryLedgerStore();
      const options = { ledgerStore, authorityKey: AUTHORITY, validatorKeys: deriveValidatorKeys('r'), chainName: 'T', rootIssuerName: 'U', difficulty: 2 };
      const first = createLedger(options);
      await first.bridge(AUTHORITY).issue('X-1', hash('x1'));
      ledgerStore.corrupt('node-2', 1, (b) => {
        b.transactions[0].payload.certHash = 'f'.repeat(64);
      });
      const restarted = createLedger(options);
      const summary = await restarted.explorer.summary();
      expect(summary.nodes[1].valid).to.equal(false);
      expect(summary.nodes[0].valid).to.equal(true);
      expect(await restarted.repair()).to.deep.equal(['node-2']);
      (await restarted.explorer.audit({ deep: true })).forEach((n) => expect(n.valid, n.node).to.equal(true));
    });
  });
});
