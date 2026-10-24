// Integration tests against a real PostgreSQL database. Skipped unless
// TEST_DATABASE_URL is set (npm run test:db starts one in Docker).
// Each run uses a fresh schema so it never touches real data.

import { expect } from 'chai';
import hre from 'hardhat';
import pg from 'pg';
import request from 'supertest';
import { createPgStore } from '../server/store.js';
import { hashPassword } from '../server/passwords.js';
import { buildApp, login } from './helpers.js';
import { buildCertificateBytes } from '../../src/lib/generateCertificatePdf.js';

const { ethers } = hre;
const url = process.env.TEST_DATABASE_URL;
const STUDENT = {
  studentName: 'Ananya Sharma',
  studentId: 'RGIT21CS014',
  credentialType: 'B.Tech in Computer Science & Engineering',
  issueDate: '2026-06-15',
};

(url ? describe : describe.skip)('PostgreSQL store (integration)', () => {
  const schema = `test_${Date.now()}`;
  const scopedUrl = () => {
    const u = new URL(url);
    u.searchParams.set('options', `-c search_path=${schema}`);
    return u.toString();
  };
  let admin, store, registry, app, token;

  before(async () => {
    admin = new pg.Client({ connectionString: url });
    await admin.connect();
    await admin.query(`CREATE SCHEMA ${schema}`);
    store = await createPgStore(scopedUrl());
    // Alliance University (the root institution) and its registrar account.
    await store.createInstitution({ id: 'alliance-university', name: 'Alliance University', status: 'approved' });
    await store.createUser({
      username: 'registrar.admin',
      passwordHash: await hashPassword('admin12345'),
      role: 'institution',
      institutionId: 'alliance-university',
    });
  });

  after(async () => {
    await store?.close();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  });

  beforeEach(async () => {
    registry = await ethers.deployContract('CredentialRegistry', ['Alliance University']);
    app = await buildApp(registry, { store });
    token = await login(app, 'registrar.admin', 'admin12345');
  });

  it('applies migrations once and records them', async () => {
    await createPgStore(scopedUrl()).then((s) => s.close()); // second run is a no-op
    const { rows } = await admin.query(`SELECT name FROM ${schema}.schema_migrations`);
    expect(rows.map((r) => r.name)).to.deep.equal(['001_init.sql', '002_lock_down_public_api.sql', '003_institutions_and_students.sql', '004_academic_registry.sql']);
    const rls = await admin.query(
      `SELECT relname, relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = $1 AND relkind = 'r'`,
      [schema]
    );
    expect(rls.rows.every((r) => r.relrowsecurity), 'RLS enabled on every table').to.equal(true);
  });

  it('persists issue -> verify -> revoke through the API', async () => {
    const auth = { Authorization: `Bearer ${token}` };
    const issued = await request(app).post('/api/credentials').set(auth).send({ ...STUDENT, credentialId: 'PG-0001' });
    expect(issued.status, JSON.stringify(issued.body)).to.equal(201);

    const { rows } = await admin.query(`SELECT * FROM ${schema}.credentials WHERE credential_id = 'PG-0001'`);
    expect(rows[0].doc_hash).to.equal(issued.body.hash);
    expect(rows[0].chain.txHash).to.equal(issued.body.record.chain.txHash);

    // The PDF rebuilt from the DB row must hash to the on-chain value.
    const record = await store.get('PG-0001');
    expect(record.issueDate).to.equal('2026-06-15');
    const byFile = await request(app)
      .post('/api/verify/file')
      .set('Content-Type', 'application/pdf')
      .send(Buffer.from(buildCertificateBytes(record)));
    expect(byFile.body.status).to.equal('valid');

    await request(app).post('/api/credentials/PG-0001/revoke').set(auth).send({ reason: 'test' });
    expect((await request(app).get('/api/verify/PG-0001')).body.status).to.equal('revoked');
  });

  it('stores batch proofs and verifies batch members', async () => {
    const credentials = [1, 2, 3].map((i) => ({ ...STUDENT, studentName: `PG ${i}`, credentialId: `PG-B00${i}` }));
    const res = await request(app)
      .post('/api/credentials/batch')
      .set('Authorization', `Bearer ${token}`)
      .send({ credentials });
    expect(res.status, JSON.stringify(res.body)).to.equal(201);
    expect((await request(app).get('/api/verify/PG-B002')).body.status).to.equal('valid');
  });

  it('enforces constraints in the database itself', async () => {
    let error;
    try {
      await store.insert({
        credentialId: 'PG-BAD',
        studentName: 'X',
        studentId: 'X',
        credentialType: 'X',
        issueDate: '2026-01-01',
        issuer: 'X',
        txHash: '0x' + '1'.repeat(64),
        hash: 'not-a-hash',
        status: 'valid',
      });
    } catch (err) {
      error = err;
    }
    expect(error?.code).to.equal('23514'); // check_violation
  });

  it('persists account lockout across requests', async () => {
    await store.createUser({ username: 'lockme', passwordHash: await hashPassword('right-password'), role: 'admin' });
    for (let i = 0; i < 5; i++) {
      await request(app).post('/api/auth/login').send({ username: 'lockme', password: 'wrong' });
    }
    const user = await store.getUser('lockme');
    expect(new Date(user.lockedUntil).getTime()).to.be.greaterThan(Date.now());
  });

  it('keeps the audit log append-only', async () => {
    await store.addAudit({ actor: 'tester', action: 'test_event' });
    let error;
    try {
      await admin.query(`DELETE FROM ${schema}.audit_log`);
    } catch (err) {
      error = err;
    }
    expect(error?.message).to.match(/append-only/);
  });
});
