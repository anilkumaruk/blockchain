// Multi-institution issuing and student accounts. Each institution signs with
// its own MetaMask account; the platform admin authorises it in the contract.

import { expect } from 'chai';
import request from 'supertest';
import { buildApp, deployRegistry, login, seededStore, signers, university } from './helpers.js';

const COLLEGE = {
  name: 'RV College of Engineering',
  email: 'registrar@rvce.example.edu',
  website: 'https://rvce.example.edu',
  password: 'college-pass-1',
};
const credential = (over = {}) => ({
  studentName: 'Meera Rao',
  studentId: 'RV21CS001',
  credentialType: 'B.E. in Computer Science',
  issueDate: '2026-06-15',
  ...over,
});

describe('Institutions and student accounts', () => {
  let registry, app, store, platform, alliance, collegeWallet, adminToken, platformToken, au;
  const as = (token) => ({ Authorization: `Bearer ${token}` });

  async function registerCollege() {
    const reg = await request(app).post('/api/institutions/register').send({ ...COLLEGE, walletAddress: collegeWallet.address });
    expect(reg.status, JSON.stringify(reg.body)).to.equal(201);
    return reg.body.institution.id;
  }

  /** The platform admin signs setIssuer in MetaMask, then the API confirms it. */
  async function registerAndApproveCollege() {
    const id = await registerCollege();
    await (await registry.connect(platform).setIssuer(collegeWallet.address, COLLEGE.name, true)).wait();
    const approved = await request(app).post(`/api/admin/institutions/${id}/approve`).set(as(platformToken));
    expect(approved.status, JSON.stringify(approved.body)).to.equal(200);
    const token = await login(app, COLLEGE.email, COLLEGE.password);
    return { id, token, approved: approved.body, college: university(app, token, collegeWallet, registry) };
  }

  beforeEach(async () => {
    [platform, alliance, , collegeWallet] = await signers();
    registry = await deployRegistry();
    store = await seededStore();
    app = await buildApp(registry, { store });
    adminToken = await login(app, 'registrar.admin', 'admin12345'); // Alliance University registrar
    platformToken = await login(app, 'platform.admin', 'platform12345');
    au = university(app, adminToken, alliance, registry);
  });

  describe('institution registration and approval', () => {
    it('starts pending and cannot sign in until approved', async () => {
      await registerCollege();
      const denied = await request(app).post('/api/auth/login').send({ username: COLLEGE.email, password: COLLEGE.password });
      expect(denied.status).to.equal(403);
      expect(denied.body.code).to.equal('pending');
    });

    it('approves only once the contract lists the wallet, and keeps no keys', async () => {
      const id = await registerCollege();
      const early = await request(app).post(`/api/admin/institutions/${id}/approve`).set(as(platformToken));
      expect(early.status).to.equal(409);
      expect(early.body.code).to.equal('not_on_chain');

      await (await registry.connect(platform).setIssuer(collegeWallet.address, COLLEGE.name, true)).wait();
      const approved = await request(app).post(`/api/admin/institutions/${id}/approve`).set(as(platformToken));
      expect(approved.body.status).to.equal('approved');
      const inst = await store.getInstitution(id);
      expect(inst.walletAddress).to.equal(collegeWallet.address);
      expect(inst.walletKeyEnc ?? null).to.equal(null);
      const onChain = await registry.issuers(collegeWallet.address);
      expect([onChain.active, onChain.name]).to.deep.equal([true, COLLEGE.name]);
    });

    it('rejects duplicate names, bad input, a missing wallet and non-admin approval', async () => {
      await registerCollege();
      const dup = await request(app).post('/api/institutions/register').send({ ...COLLEGE, email: 'other@rvce.example.edu', walletAddress: platform.address });
      expect(dup.status).to.equal(409);
      const noWallet = await request(app).post('/api/institutions/register').send({ ...COLLEGE, name: 'Z Uni', email: 'z@z.edu' });
      expect(noWallet.status).to.equal(400);
      const badEmail = await request(app).post('/api/institutions/register').send({ ...COLLEGE, name: 'X Uni', email: 'nope', walletAddress: platform.address });
      expect(badEmail.status).to.equal(400);
      const weak = await request(app).post('/api/institutions/register').send({ ...COLLEGE, name: 'Y Uni', email: 'y@y.edu', password: 'short', walletAddress: platform.address });
      expect(weak.status).to.equal(400);

      const studentToken = await login(app, 'ananya', 'student12345');
      const forbidden = await request(app).post('/api/admin/institutions/rv-college-of-engineering/approve').set(as(studentToken));
      expect(forbidden.status).to.equal(403);
    });

    it('lists approved institutions publicly', async () => {
      await registerAndApproveCollege();
      const res = await request(app).get('/api/institutions');
      expect(res.body.map((i) => i.name)).to.include.members(['Alliance University', COLLEGE.name]);
    });
  });

  describe('issuing as an institution', () => {
    it("records the credential under the institution's own wallet and verifies it", async () => {
      const { id, college } = await registerAndApproveCollege();
      const issued = await college.issue(credential());
      expect(issued.status, JSON.stringify(issued.body)).to.equal(201);
      expect(issued.body.record).to.include({ issuer: COLLEGE.name, institutionId: id });
      const [onChain] = await registry.getCredential(issued.body.credentialId);
      expect(onChain.issuer).to.equal(collegeWallet.address);

      const verdict = await request(app).get(`/api/verify/${issued.body.credentialId}`);
      expect(verdict.body.status).to.equal('valid');
      expect(verdict.body.details.issuerInstitution.name).to.equal(COLLEGE.name);
    });

    it('scopes lists and revocation to the issuing institution', async () => {
      const { token, college } = await registerAndApproveCollege();
      const mine = await college.issue(credential());
      const auCred = await au.issue(credential({ studentId: 'AU21CS001', studentName: 'Alliance Student' }));

      const collegeList = await request(app).get('/api/credentials').set(as(token));
      expect(collegeList.body.map((c) => c.credentialId)).to.deep.equal([mine.body.credentialId]);
      const allianceList = await request(app).get('/api/credentials').set(as(adminToken));
      expect(allianceList.body.map((c) => c.credentialId)).to.deep.equal([auCred.body.credentialId]);
      // The platform admin manages institutions, not credentials.
      expect((await request(app).get('/api/credentials').set(as(platformToken))).status).to.equal(403);
      expect((await request(app).post('/api/credentials/prepare').set(as(platformToken)).send(credential())).status).to.equal(403);
      const institutionsView = await request(app).get('/api/admin/institutions').set(as(platformToken));
      const counts = Object.fromEntries(institutionsView.body.map((i) => [i.name, i.credentialCount]));
      expect(counts).to.include({ 'Alliance University': 1, [COLLEGE.name]: 1 });

      const crossRevoke = await request(app).post(`/api/credentials/${auCred.body.credentialId}/revoke`).set(as(token)).send({ reason: 'not mine' });
      expect(crossRevoke.status).to.equal(403);
      // ...and the contract refuses it too: only the original issuer may revoke.
      await expect(registry.connect(collegeWallet).revokeCredential(auCred.body.credentialId, '0x' + '11'.repeat(32))).to.be.revertedWithCustomError(
        registry,
        'NotOriginalIssuer'
      );

      const ownRevoke = await college.revoke(mine.body.credentialId, 'Issued in error');
      expect(ownRevoke.status, JSON.stringify(ownRevoke.body)).to.equal(200);
      expect((await request(app).get(`/api/verify/${mine.body.credentialId}`)).body.status).to.equal('revoked');
    });

    it('batch-issues with one Merkle root signed by the institution', async () => {
      const { college } = await registerAndApproveCollege();
      const res = await college.batch([credential(), credential({ studentId: 'RV21CS002', studentName: 'Arjun N' })]);
      expect(res.status, JSON.stringify(res.body)).to.equal(201);
      const v = await request(app).get(`/api/verify/${res.body.credentials[1].credentialId}`);
      expect(v.body.status).to.equal('valid');
      expect(v.body.details.issuer).to.equal(COLLEGE.name);
      expect(v.body.details.onChain.proof.mode).to.equal('merkle-batch');
    });

    it('suspension blocks sign-in and makes its credentials fail verification', async () => {
      const { id, token, college } = await registerAndApproveCollege();
      const issued = await college.issue(credential());
      const early = await request(app).post(`/api/admin/institutions/${id}/suspend`).set(as(platformToken));
      expect(early.body.code).to.equal('not_on_chain'); // the contract must say so first
      await (await registry.connect(platform).setIssuer(collegeWallet.address, COLLEGE.name, false)).wait();
      expect((await request(app).post(`/api/admin/institutions/${id}/suspend`).set(as(platformToken))).status).to.equal(200);

      const verdict = await request(app).get(`/api/verify/${issued.body.credentialId}`);
      expect(verdict.body).to.include({ status: 'invalid', code: 'untrusted_issuer' });

      const relogin = await request(app).post('/api/auth/login').send({ username: COLLEGE.email, password: COLLEGE.password });
      expect(relogin.body.code).to.equal('suspended');
      // A token issued before suspension can no longer issue either.
      const blocked = await request(app).post('/api/credentials/prepare').set(as(token)).send(credential({ studentId: 'RV21CS009' }));
      expect(blocked.status).to.equal(403);
      expect(blocked.body.error).to.match(/suspended/);
    });
  });

  describe('student accounts', () => {
    it('lets a student register only with the email their institution has on record', async () => {
      const refused = await request(app).post('/api/auth/register/student').send({ email: 'meera.rao@gmail.com', password: 'my-own-pass' });
      expect(refused.status).to.equal(404);
      expect(refused.body.code).to.equal('no_student_record');

      expect((await au.issue(credential({ studentEmail: 'Meera.Rao@gmail.com' }))).status).to.equal(201);
      const ok = await request(app).post('/api/auth/register/student').send({ email: 'meera.rao@gmail.com', password: 'my-own-pass' });
      expect(ok.status, JSON.stringify(ok.body)).to.equal(201);
      expect(ok.body.studentId).to.equal('RV21CS001');
      const again = await request(app).post('/api/auth/register/student').send({ email: 'meera.rao@gmail.com', password: 'my-own-pass' });
      expect(again.status).to.equal(409);
    });

    it('signs in with the personal email and sees only their own credentials', async () => {
      await au.issue(credential({ studentEmail: 'meera.rao@gmail.com' }));
      await au.issue(credential({ studentId: 'AU21CS777', studentName: 'Someone Else' }));
      await request(app).post('/api/auth/register/student').send({ email: 'meera.rao@gmail.com', password: 'my-own-pass' });

      const session = await request(app).post('/api/auth/login').send({ username: 'MEERA.RAO@gmail.com', password: 'my-own-pass' });
      expect(session.body.role).to.equal('student');
      const mine = await request(app).get('/api/me/credentials').set(as(session.body.token));
      expect(mine.body.map((c) => c.studentId)).to.deep.equal(['RV21CS001']);
      const certificates = await request(app).get('/api/me/certificates').set(as(session.body.token));
      expect(certificates.body).to.have.length(1);
      expect(certificates.body[0]).to.include({ status: 'valid', marksVerified: true });
      expect((await request(app).get('/api/me').set(as(session.body.token))).body.fullName).to.equal('Meera Rao');
      expect((await request(app).post('/api/credentials/prepare').set(as(session.body.token)).send(credential())).status).to.equal(403);
    });

    it('will not let two students share one email', async () => {
      await au.issue(credential({ studentEmail: 'shared@gmail.com' }));
      const clash = await au.issue(credential({ studentId: 'OTHER-1', studentName: 'Other', studentEmail: 'shared@gmail.com' }));
      expect(clash.status).to.equal(409);
      // Refused when preparing, before anything was signed: only the first credential exists.
      expect(await registry.totalIssued()).to.equal(1n);
    });
  });
});
