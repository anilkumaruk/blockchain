// End-to-end tests for the 10 structured scenarios listed in the Review-1
// "Experimentation" slide. Each test drives the real Express API and a real
// CredentialRegistry on Hardhat's in-process Ethereum. Transactions are signed
// by the university's account, as MetaMask does in the browser.

import { expect } from 'chai';
import hre from 'hardhat';
import request from 'supertest';
import { Contract, JsonRpcProvider } from 'ethers';
import { buildApp, deployRegistry, login, seededStore, signers, university } from './helpers.js';
import { documentHash } from '../server/hash.js';
import { issuedCanonical } from '../../src/lib/certificateView.js';

const { ethers } = hre;
const STUDENT = {
  studentName: 'Ananya Sharma',
  studentId: 'RGIT21CS014',
  credentialType: 'B.Tech in Computer Science & Engineering',
  issueDate: '2026-06-15',
};

describe('Review-1 experimentation scenarios (end-to-end)', () => {
  let registry, app, uni, registrar, rogue, token;

  async function issue(body = STUDENT) {
    const res = await uni.issue(body);
    expect(res.status, JSON.stringify(res.body)).to.equal(201);
    return res.body;
  }

  beforeEach(async () => {
    [, registrar, rogue] = await signers();
    registry = await deployRegistry();
    app = await buildApp(registry);
    token = await login(app, 'registrar.admin', 'admin12345');
    uni = university(app, token, registrar, registry);
  });

  it('1. Valid credential: original certificate -> Verified', async () => {
    const issued = await issue();
    expect(issued.hash).to.match(/^0x[0-9a-f]{64}$/);
    expect(issued.record.chain.txHash).to.match(/^0x[0-9a-f]{64}$/);
    expect(issued.record.chain.blockNumber).to.be.a('number');

    const [onChain] = await registry.getCredential(issued.credentialId);
    expect(onChain.docHash).to.equal(issued.hash);
    expect(onChain.issuer).to.equal(registrar.address);

    const byId = await request(app).get(`/api/verify/${issued.credentialId}`);
    expect(byId.body.status).to.equal('valid');
    expect(byId.body.details.studentName).to.equal('Ananya Sharma');
    expect(byId.body.details.onChain.proof.blockNumber).to.equal(issued.record.chain.blockNumber);

    const byHash = await request(app).post('/api/verify/hash').send({ hash: issued.hash });
    expect(byHash.body.status).to.equal('valid');
  });

  it('2. Modified certificate: one character changed -> Hash mismatch', async () => {
    const issued = await issue();
    const forged = documentHash(issuedCanonical({ ...issued.record, studentName: 'Ananyb Sharma' }));
    const res = await request(app).post('/api/verify/hash').send({ hash: forged });
    expect(res.status).to.equal(200);
    expect(res.body).to.include({ status: 'invalid', code: 'hash_mismatch' });
  });

  it('3. Invalid credential ID: unknown ID -> Not found', async () => {
    const res = await request(app).get('/api/verify/COR-2099-DEADBE');
    expect(res.body).to.include({ status: 'invalid', code: 'not_found' });
  });

  it('4. Revoked credential: university revoked it -> Revoked', async () => {
    const issued = await issue();
    const rev = await uni.revoke(issued.credentialId, 'Issued in error');
    expect(rev.status, JSON.stringify(rev.body)).to.equal(200);
    expect(rev.body.revocation.reason).to.equal('Issued in error');

    const res = await request(app).get(`/api/verify/${issued.credentialId}`);
    expect(res.body.status).to.equal('revoked');
    expect(res.body.details.onChain.revokedAt).to.be.a('string');
    // Revocation is a state change: the original document hash is still on-chain.
    const [onChain] = await registry.getCredential(issued.credentialId);
    expect(onChain.docHash).to.equal(issued.hash);
  });

  it('5. Wrong issuer: unauthorized issuer -> Verification failed', async () => {
    // Another wallet is authorised on the shared contract but is not an
    // institution this platform approved.
    await registry.setIssuer(rogue.address, 'Unknown Institute', true);
    await registry.connect(rogue).issueCredential('COR-2026-FAKE01', '0x' + 'ab'.repeat(32));

    const res = await request(app).get('/api/verify/COR-2026-FAKE01');
    expect(res.body).to.include({ status: 'invalid', code: 'untrusted_issuer' });
    expect(res.body.details.issuer).to.equal(rogue.address);
  });

  it('6. Duplicate credential ID: existing ID reused -> Rejected', async () => {
    const issued = await issue();
    const res = await uni.issue({ ...STUDENT, credentialId: issued.credentialId });
    expect(res.status).to.equal(409);
    // Even bypassing the API, the contract itself refuses the duplicate.
    await expect(
      registry.connect(registrar).issueCredential(issued.credentialId, '0x' + 'cd'.repeat(32))
    ).to.be.revertedWithCustomError(registry, 'CredentialAlreadyExists');
  });

  it('7. Unauthorized issuance: non-registrar or unauthorised wallet -> Access denied', async () => {
    expect((await request(app).post('/api/credentials/prepare').send(STUDENT)).status).to.equal(401);
    const studentToken = await login(app, 'ananya', 'student12345');
    expect((await request(app).post('/api/credentials/prepare').set('Authorization', `Bearer ${studentToken}`).send(STUDENT)).status).to.equal(403);
    expect((await request(app).post('/api/credentials/prepare').set('Authorization', 'Bearer not.a.real.token').send(STUDENT)).status).to.equal(401);
    expect((await request(app).post('/api/auth/login').send({ username: 'registrar.admin', password: 'wrong' })).status).to.equal(401);
    // A wallet the platform never authorised cannot write to the contract at all.
    await expect(registry.connect(rogue).issueCredential('COR-2026-ROGUE1', '0x' + 'ef'.repeat(32))).to.be.revertedWithCustomError(
      registry,
      'NotAuthorizedIssuer'
    );
    expect(await registry.totalIssued()).to.equal(0n);
  });

  it('8. Blockchain unavailable: network down -> Unavailable (fails safe)', async () => {
    const deadProvider = new JsonRpcProvider('http://127.0.0.1:9', undefined, { staticNetwork: true });
    const deadContract = new Contract(await registry.getAddress(), registry.interface, deadProvider);
    const offline = await buildApp(deadContract, { timeoutMs: 3000 });

    const res = await request(offline).get('/api/verify/COR-2026-ANYTHING');
    expect(res.status).to.equal(503);
    expect(res.body.status).to.equal('unavailable');

    const health = await request(offline).get('/api/health');
    expect(health.status).to.equal(503);
    deadProvider.destroy();
  });

  it('9. Tampered submission: details differ from what was signed -> Rejected', async () => {
    const auth = { Authorization: `Bearer ${token}` };
    // Nothing signed yet: the server records nothing.
    const unsigned = await request(app).post('/api/credentials').set(auth).send({ ...STUDENT, credentialId: 'COR-2026-UNSIGN' });
    expect(unsigned.status).to.equal(409);
    expect(unsigned.body.code).to.equal('not_on_chain');
    // Signed one document, then submitted different details for it.
    const prep = (await request(app).post('/api/credentials/prepare').set(auth).send(STUDENT)).body;
    await (await registry.connect(registrar).issueCredential(prep.credentialId, prep.docHash)).wait();
    const swapped = await request(app).post('/api/credentials').set(auth).send({ ...prep.fields, studentName: 'Someone Else' });
    expect(swapped.status).to.equal(409);
    expect(swapped.body.code).to.equal('hash_mismatch');
    // Signed by another authorised wallet, not this university's.
    await registry.setIssuer(rogue.address, 'Other', true);
    const prep2 = (await request(app).post('/api/credentials/prepare').set(auth).send({ ...STUDENT, studentId: 'X2' })).body;
    await (await registry.connect(rogue).issueCredential(prep2.credentialId, prep2.docHash)).wait();
    const foreign = await request(app).post('/api/credentials').set(auth).send(prep2.fields);
    expect(foreign.status).to.equal(403);
    expect(foreign.body.code).to.equal('wrong_issuer');
  });

  it('10. Corrected credential: old revoked, new issued -> New credential valid', async () => {
    const original = await issue({ ...STUDENT, studentName: 'Ananya Shrama' }); // typo
    expect((await uni.revoke(original.credentialId, 'Name spelling corrected')).status).to.equal(200);
    const fixed = await issue({ ...STUDENT, replaces: original.credentialId });
    expect(fixed.record.replaces).to.equal(original.credentialId);

    const oldVerdict = await request(app).get(`/api/verify/${original.credentialId}`);
    expect(oldVerdict.body.status).to.equal('revoked');
    expect(oldVerdict.body.details.replacedBy).to.equal(fixed.credentialId);

    const newVerdict = await request(app).get(`/api/verify/${fixed.credentialId}`);
    expect(newVerdict.body.status).to.equal('valid');
    expect(newVerdict.body.details.studentName).to.equal('Ananya Sharma');
  });

  it('detects tampering of the off-chain database record', async () => {
    const store = await seededStore();
    const tamperApp = await buildApp(registry, { store });
    const t = await login(tamperApp, 'registrar.admin', 'admin12345');
    const issued = await university(tamperApp, t, registrar, registry).issue(STUDENT);
    await store.update(issued.body.credentialId, { hash: '0x' + '00'.repeat(32) });

    const res = await request(tamperApp).get(`/api/verify/${issued.body.credentialId}`);
    expect(res.body).to.include({ status: 'invalid', code: 'record_mismatch' });
  });

  it('refuses a revocation the contract does not show, or with a different reason', async () => {
    const issued = await issue();
    const auth = { Authorization: `Bearer ${token}` };
    const early = await request(app).post(`/api/credentials/${issued.credentialId}/revoke`).set(auth).send({ reason: 'x' });
    expect(early.body.code).to.equal('not_revoked_on_chain');
    await (await registry.connect(registrar).revokeCredential(issued.credentialId, ethers.keccak256(ethers.toUtf8Bytes('Real reason')))).wait();
    const lie = await request(app).post(`/api/credentials/${issued.credentialId}/revoke`).set(auth).send({ reason: 'Another reason' });
    expect(lie.body.code).to.equal('reason_mismatch');
  });
});
