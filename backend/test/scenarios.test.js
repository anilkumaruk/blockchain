// End-to-end tests for the 10 structured scenarios listed in the Review-1
// "Experimentation" slide. Each test drives the real Express API, which
// talks to a real CredentialRegistry deployed on Hardhat's in-process EVM.

import { expect } from 'chai';
import hre from 'hardhat';
import request from 'supertest';
import { Contract, JsonRpcProvider } from 'ethers';
import { buildApp, login, seededStore } from './helpers.js';
import { buildCertificateBytes } from '../../src/lib/generateCertificatePdf.js';

const { ethers } = hre;
const STUDENT = {
  studentName: 'Ananya Sharma',
  studentId: 'RGIT21CS014',
  credentialType: 'B.Tech in Computer Science & Engineering',
  issueDate: '2026-06-15',
};

describe('Review-1 experimentation scenarios (end-to-end)', () => {
  let registry, rogue, app, adminToken;

  async function issue(body = STUDENT) {
    const res = await request(app)
      .post('/api/credentials')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(body);
    expect(res.status, JSON.stringify(res.body)).to.equal(201);
    return res.body;
  }

  beforeEach(async () => {
    [, rogue] = await ethers.getSigners();
    registry = await ethers.deployContract('CredentialRegistry', ['Alliance University']);
    app = await buildApp(registry);
    adminToken = await login(app, 'registrar.admin', 'admin12345');
  });

  it('1. Valid credential: original certificate -> Verified', async () => {
    const issued = await issue();
    expect(issued.hash).to.match(/^0x[0-9a-f]{64}$/);
    expect(issued.record.chain.txHash).to.match(/^0x[0-9a-f]{64}$/);

    const [onChain] = await registry.getCredential(issued.credentialId);
    expect(onChain.docHash).to.equal(issued.hash);

    const byId = await request(app).get(`/api/verify/${issued.credentialId}`);
    expect(byId.body.status).to.equal('valid');
    expect(byId.body.details.studentName).to.equal('Ananya Sharma');

    const pdf = Buffer.from(buildCertificateBytes(issued.record));
    const byFile = await request(app)
      .post('/api/verify/file')
      .set('Content-Type', 'application/pdf')
      .send(pdf);
    expect(byFile.body.status).to.equal('valid');
    expect(byFile.body.details.credentialId).to.equal(issued.credentialId);
  });

  it('2. Modified certificate: PDF content changed -> Hash mismatch', async () => {
    const issued = await issue();
    const forged = Buffer.from(buildCertificateBytes(issued.record));
    // Single-character edit: "Ananya" -> "Ananyb"
    const i = forged.indexOf('Ananya');
    forged[i + 5] = 'b'.charCodeAt(0);

    const res = await request(app)
      .post('/api/verify/file')
      .set('Content-Type', 'application/pdf')
      .send(forged);
    expect(res.status).to.equal(200);
    expect(res.body.status).to.equal('invalid');
    expect(res.body.code).to.equal('hash_mismatch');
  });

  it('3. Invalid credential ID: unknown ID -> Not found', async () => {
    const res = await request(app).get('/api/verify/COR-2099-DEADBE');
    expect(res.body.status).to.equal('invalid');
    expect(res.body.code).to.equal('not_found');
  });

  it('4. Revoked credential: university revoked it -> Revoked', async () => {
    const issued = await issue();
    const rev = await request(app)
      .post(`/api/credentials/${issued.credentialId}/revoke`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'Issued in error' });
    expect(rev.status).to.equal(200);
    expect(rev.body.revocation.reason).to.equal('Issued in error');

    const res = await request(app).get(`/api/verify/${issued.credentialId}`);
    expect(res.body.status).to.equal('revoked');
    expect(res.body.details.onChain.revokedAt).to.be.a('string');
    // Revocation is a state change: the original fingerprint is still on-chain.
    const [onChain] = await registry.getCredential(issued.credentialId);
    expect(onChain.docHash).to.equal(issued.hash);
  });

  it('5. Wrong issuer: unauthorized issuer -> Verification failed', async () => {
    // A second issuer is registered on the shared registry and issues a
    // credential directly. It is not this university's trusted issuer.
    await registry.setIssuer(rogue.address, 'Unknown Institute', true);
    await registry.connect(rogue).issueCredential('COR-2026-FAKE01', '0x' + 'ab'.repeat(32));

    const res = await request(app).get('/api/verify/COR-2026-FAKE01');
    expect(res.body.status).to.equal('invalid');
    expect(res.body.code).to.equal('untrusted_issuer');
    expect(res.body.details.issuer).to.equal(rogue.address);
  });

  it('6. Duplicate credential ID: existing ID reused -> Rejected', async () => {
    const issued = await issue();
    const res = await request(app)
      .post('/api/credentials')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...STUDENT, credentialId: issued.credentialId });
    expect(res.status).to.equal(409);

    // Even bypassing the API, the contract itself refuses the duplicate.
    await expect(
      registry.issueCredential(issued.credentialId, '0x' + 'cd'.repeat(32))
    ).to.be.revertedWithCustomError(registry, 'CredentialAlreadyExists');
  });

  it('7. Unauthorized issuance: non-admin attempts issue -> Access denied', async () => {
    const noToken = await request(app).post('/api/credentials').send(STUDENT);
    expect(noToken.status).to.equal(401);

    const studentToken = await login(app, 'ananya', 'student12345');
    const asStudent = await request(app)
      .post('/api/credentials')
      .set('Authorization', `Bearer ${studentToken}`)
      .send(STUDENT);
    expect(asStudent.status).to.equal(403);

    const forgedToken = await request(app)
      .post('/api/credentials')
      .set('Authorization', 'Bearer not.a.real.token')
      .send(STUDENT);
    expect(forgedToken.status).to.equal(401);

    const badLogin = await request(app)
      .post('/api/auth/login')
      .send({ username: 'registrar.admin', password: 'wrong' });
    expect(badLogin.status).to.equal(401);

    expect(await registry.totalIssued()).to.equal(0n);
  });

  it('8. Blockchain unavailable: network down -> Unavailable (fails safe)', async () => {
    const deadProvider = new JsonRpcProvider('http://127.0.0.1:9', undefined, { staticNetwork: true });
    const deadContract = new Contract(await registry.getAddress(), registry.interface, deadProvider);
    const offline = await buildApp(deadContract, { timeoutMs: 3000 });

    const res = await request(offline).get('/api/verify/COR-2026-ANYTHING');
    expect(res.status).to.equal(503);
    expect(res.body.status).to.equal('unavailable');
    expect(res.body.status).to.not.equal('valid');

    const health = await request(offline).get('/api/health');
    expect(health.status).to.equal(503);
    deadProvider.destroy();
  });

  it('9. Invalid file format: corrupted / unsupported -> File rejected', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const res = await request(app).post('/api/verify/file').set('Content-Type', 'image/png').send(png);
    expect(res.status).to.equal(415);
    expect(res.body.code).to.equal('invalid_file');

    const empty = await request(app)
      .post('/api/verify/file')
      .set('Content-Type', 'application/pdf')
      .send(Buffer.alloc(0));
    expect(empty.status).to.equal(415);
  });

  it('10. Corrected credential: old revoked, new issued -> New credential valid', async () => {
    const original = await issue({ ...STUDENT, studentName: 'Ananya Shrama' }); // typo
    const res = await request(app)
      .post(`/api/credentials/${original.credentialId}/reissue`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ studentName: 'Ananya Sharma', reason: 'Name spelling corrected' });
    expect(res.status).to.equal(201);
    expect(res.body.record.replaces).to.equal(original.credentialId);

    const oldVerdict = await request(app).get(`/api/verify/${original.credentialId}`);
    expect(oldVerdict.body.status).to.equal('revoked');
    expect(oldVerdict.body.details.replacedBy).to.equal(res.body.credentialId);

    const newVerdict = await request(app).get(`/api/verify/${res.body.credentialId}`);
    expect(newVerdict.body.status).to.equal('valid');
    expect(newVerdict.body.details.studentName).to.equal('Ananya Sharma');
  });

  it('detects tampering of the off-chain database record', async () => {
    const store = await seededStore();
    const tamperApp = await buildApp(registry, { store });
    const token = await login(tamperApp, 'registrar.admin', 'admin12345');
    const issued = await request(tamperApp)
      .post('/api/credentials')
      .set('Authorization', `Bearer ${token}`)
      .send(STUDENT);
    await store.update(issued.body.credentialId, { hash: '0x' + '00'.repeat(32) });

    const res = await request(tamperApp).get(`/api/verify/${issued.body.credentialId}`);
    expect(res.body.status).to.equal('invalid');
    expect(res.body.code).to.equal('record_mismatch');
  });
});
