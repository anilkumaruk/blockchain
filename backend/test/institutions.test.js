// Multi-institution issuing and student accounts.

import { expect } from 'chai';
import hre from 'hardhat';
import request from 'supertest';
import { buildApp, login, seededStore, TEST_WALLET_KEY } from './helpers.js';
import { decryptKey } from '../server/wallets.js';

const { ethers } = hre;
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
  let registry, app, store, adminToken;
  const as = (token) => ({ Authorization: `Bearer ${token}` });

  async function registerAndApproveCollege() {
    const reg = await request(app).post('/api/institutions/register').send(COLLEGE);
    expect(reg.status, JSON.stringify(reg.body)).to.equal(201);
    const approved = await request(app)
      .post(`/api/admin/institutions/${reg.body.institution.id}/approve`)
      .set(as(adminToken));
    expect(approved.status, JSON.stringify(approved.body)).to.equal(200);
    return { id: reg.body.institution.id, token: await login(app, COLLEGE.email, COLLEGE.password), approved: approved.body };
  }

  beforeEach(async () => {
    registry = await ethers.deployContract('CredentialRegistry', ['Alliance University']);
    store = await seededStore();
    app = await buildApp(registry, { store });
    adminToken = await login(app, 'registrar.admin', 'admin12345');
  });

  describe('institution registration and approval', () => {
    it('starts pending and cannot sign in until approved', async () => {
      const reg = await request(app).post('/api/institutions/register').send(COLLEGE);
      expect(reg.status).to.equal(201);
      expect(reg.body.institution.status).to.equal('pending');

      const denied = await request(app).post('/api/auth/login').send({ username: COLLEGE.email, password: COLLEGE.password });
      expect(denied.status).to.equal(403);
      expect(denied.body.code).to.equal('pending');
    });

    it('approval creates an encrypted wallet, authorizes it on-chain and funds it', async () => {
      const { id, approved } = await registerAndApproveCollege();
      expect(approved.status).to.equal('approved');
      expect(approved).to.not.have.property('walletKeyEnc');

      const inst = await store.getInstitution(id);
      expect(inst.walletKeyEnc).to.match(/^v1:/);
      const wallet = new ethers.Wallet(decryptKey(inst.walletKeyEnc, TEST_WALLET_KEY));
      expect(wallet.address).to.equal(inst.walletAddress);

      const onChain = await registry.issuers(inst.walletAddress);
      expect(onChain.active).to.equal(true);
      expect(onChain.name).to.equal(COLLEGE.name);
      expect(await ethers.provider.getBalance(inst.walletAddress)).to.be.greaterThan(0n);
    });

    it('rejects duplicate names, bad input, and non-admin approval', async () => {
      await request(app).post('/api/institutions/register').send(COLLEGE);
      const dup = await request(app)
        .post('/api/institutions/register')
        .send({ ...COLLEGE, email: 'other@rvce.example.edu' });
      expect(dup.status).to.equal(409);
      const badEmail = await request(app).post('/api/institutions/register').send({ ...COLLEGE, name: 'X Uni', email: 'nope' });
      expect(badEmail.status).to.equal(400);
      const weak = await request(app)
        .post('/api/institutions/register')
        .send({ ...COLLEGE, name: 'Y Uni', email: 'y@y.edu', password: 'short' });
      expect(weak.status).to.equal(400);

      const studentToken = await login(app, 'ananya', 'student12345');
      const forbidden = await request(app)
        .post('/api/admin/institutions/rv-college-of-engineering/approve')
        .set(as(studentToken));
      expect(forbidden.status).to.equal(403);
    });

    it('lists approved institutions publicly without wallet keys', async () => {
      await registerAndApproveCollege();
      const res = await request(app).get('/api/institutions');
      expect(res.body.map((i) => i.name)).to.include.members(['Alliance University', COLLEGE.name]);
      expect(JSON.stringify(res.body)).to.not.include('v1:');
    });
  });

  describe('issuing as an institution', () => {
    it('records the credential on-chain under the institution\'s own wallet and verifies it', async () => {
      const { id, token } = await registerAndApproveCollege();
      const issued = await request(app).post('/api/credentials').set(as(token)).send(credential());
      expect(issued.status, JSON.stringify(issued.body)).to.equal(201);
      expect(issued.body.record.issuer).to.equal(COLLEGE.name);
      expect(issued.body.record.institutionId).to.equal(id);

      const inst = await store.getInstitution(id);
      const [onChain] = await registry.getCredential(issued.body.credentialId);
      expect(onChain.issuer).to.equal(inst.walletAddress);

      const verdict = await request(app).get(`/api/verify/${issued.body.credentialId}`);
      expect(verdict.body.status).to.equal('valid');
      expect(verdict.body.details.issuerInstitution.name).to.equal(COLLEGE.name);
    });

    it('scopes lists and revocation to the issuing institution', async () => {
      const { token } = await registerAndApproveCollege();
      const mine = await request(app).post('/api/credentials').set(as(token)).send(credential());
      const rootCred = await request(app)
        .post('/api/credentials')
        .set(as(adminToken))
        .send(credential({ studentId: 'AU21CS001', studentName: 'Root Student' }));

      const collegeList = await request(app).get('/api/credentials').set(as(token));
      expect(collegeList.body.map((c) => c.credentialId)).to.deep.equal([mine.body.credentialId]);
      const adminList = await request(app).get('/api/credentials').set(as(adminToken));
      expect(adminList.body).to.have.length(2);

      const crossRevoke = await request(app)
        .post(`/api/credentials/${rootCred.body.credentialId}/revoke`)
        .set(as(token))
        .send({ reason: 'not mine' });
      expect(crossRevoke.status).to.equal(403);
      const adminCross = await request(app)
        .post(`/api/credentials/${mine.body.credentialId}/revoke`)
        .set(as(adminToken))
        .send({ reason: 'not mine either' });
      expect(adminCross.status).to.equal(403);

      const ownRevoke = await request(app)
        .post(`/api/credentials/${mine.body.credentialId}/revoke`)
        .set(as(token))
        .send({ reason: 'Issued in error' });
      expect(ownRevoke.status).to.equal(200);
      expect((await request(app).get(`/api/verify/${mine.body.credentialId}`)).body.status).to.equal('revoked');
    });

    it('batch-issues with the institution wallet', async () => {
      const { token } = await registerAndApproveCollege();
      const res = await request(app)
        .post('/api/credentials/batch')
        .set(as(token))
        .send({ credentials: [credential(), credential({ studentId: 'RV21CS002', studentName: 'Arjun N' })] });
      expect(res.status, JSON.stringify(res.body)).to.equal(201);
      const v = await request(app).get(`/api/verify/${res.body.credentials[1].credentialId}`);
      expect(v.body.status).to.equal('valid');
      expect(v.body.details.issuer).to.equal(COLLEGE.name);
    });

    it('suspension blocks sign-in and makes its credentials fail verification', async () => {
      const { id, token } = await registerAndApproveCollege();
      const issued = await request(app).post('/api/credentials').set(as(token)).send(credential());
      const suspended = await request(app).post(`/api/admin/institutions/${id}/suspend`).set(as(adminToken));
      expect(suspended.status).to.equal(200);

      const verdict = await request(app).get(`/api/verify/${issued.body.credentialId}`);
      expect(verdict.body.status).to.equal('invalid');
      expect(verdict.body.code).to.equal('untrusted_issuer');

      const relogin = await request(app).post('/api/auth/login').send({ username: COLLEGE.email, password: COLLEGE.password });
      expect(relogin.status).to.equal(403);
      expect(relogin.body.code).to.equal('suspended');
      // A token issued before suspension can no longer issue either.
      const blocked = await request(app).post('/api/credentials').set(as(token)).send(credential({ studentId: 'RV21CS009' }));
      expect(blocked.status).to.equal(403);
    });
  });

  describe('student accounts', () => {
    it('lets a student register only with the email their institution has on record', async () => {
      const refused = await request(app)
        .post('/api/auth/register/student')
        .send({ email: 'meera.rao@gmail.com', password: 'my-own-pass' });
      expect(refused.status).to.equal(404);
      expect(refused.body.code).to.equal('no_student_record');

      await request(app)
        .post('/api/credentials')
        .set(as(adminToken))
        .send(credential({ studentEmail: 'Meera.Rao@gmail.com' }));

      const ok = await request(app)
        .post('/api/auth/register/student')
        .send({ email: 'meera.rao@gmail.com', password: 'my-own-pass' });
      expect(ok.status, JSON.stringify(ok.body)).to.equal(201);
      expect(ok.body.studentId).to.equal('RV21CS001');

      const again = await request(app)
        .post('/api/auth/register/student')
        .send({ email: 'meera.rao@gmail.com', password: 'my-own-pass' });
      expect(again.status).to.equal(409);
    });

    it('signs in with the personal email and sees only their own credentials', async () => {
      await request(app).post('/api/credentials').set(as(adminToken)).send(credential({ studentEmail: 'meera.rao@gmail.com' }));
      await request(app)
        .post('/api/credentials')
        .set(as(adminToken))
        .send(credential({ studentId: 'AU21CS777', studentName: 'Someone Else' }));
      await request(app).post('/api/auth/register/student').send({ email: 'meera.rao@gmail.com', password: 'my-own-pass' });

      const session = await request(app).post('/api/auth/login').send({ username: 'MEERA.RAO@gmail.com', password: 'my-own-pass' });
      expect(session.status).to.equal(200);
      expect(session.body.role).to.equal('student');

      const mine = await request(app).get('/api/me/credentials').set(as(session.body.token));
      expect(mine.body.map((c) => c.studentId)).to.deep.equal(['RV21CS001']);
      const me = await request(app).get('/api/me').set(as(session.body.token));
      expect(me.body.fullName).to.equal('Meera Rao');

      const cannotIssue = await request(app).post('/api/credentials').set(as(session.body.token)).send(credential());
      expect(cannotIssue.status).to.equal(403);
    });

    it('will not let two students share one email', async () => {
      await request(app).post('/api/credentials').set(as(adminToken)).send(credential({ studentEmail: 'shared@gmail.com' }));
      const clash = await request(app)
        .post('/api/credentials')
        .set(as(adminToken))
        .send(credential({ studentId: 'OTHER-1', studentName: 'Other', studentEmail: 'shared@gmail.com' }));
      expect(clash.status).to.equal(409);
      // Refused before anything was written: only the first credential exists.
      expect(await registry.totalIssued()).to.equal(1n);
    });
  });
});
