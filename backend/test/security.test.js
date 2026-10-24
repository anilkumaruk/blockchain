// Security controls: authentication hardening, rate limiting, headers,
// audit logging, input validation, emergency pause, ownership and config.

import { expect } from 'chai';
import hre from 'hardhat';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { buildApp, login, seededStore } from './helpers.js';
import { hashPassword, verifyPassword } from '../server/passwords.js';
import { databaseSslFromEnv, loadConfig, HARDHAT_DEV_KEY } from '../server/config.js';

const { ethers } = hre;
const STUDENT = {
  studentName: 'Ananya Sharma',
  studentId: 'RGIT21CS014',
  credentialType: 'B.Tech in Computer Science & Engineering',
  issueDate: '2026-06-15',
};

describe('Security', () => {
  let registry, app, token;

  beforeEach(async () => {
    registry = await ethers.deployContract('CredentialRegistry', ['Alliance University']);
    app = await buildApp(registry);
    token = await login(app, 'registrar.admin', 'admin12345');
  });

  describe('passwords', () => {
    it('stores salted scrypt hashes, never plaintext', async () => {
      const a = await hashPassword('correct horse');
      const b = await hashPassword('correct horse');
      expect(a).to.match(/^scrypt\$/);
      expect(a).to.not.include('correct horse');
      expect(a).to.not.equal(b); // unique salt per hash
      expect(await verifyPassword('correct horse', a)).to.equal(true);
      expect(await verifyPassword('wrong horse', a)).to.equal(false);
    });

    it('rejects passwords shorter than 8 characters', async () => {
      let error;
      try {
        await hashPassword('short');
      } catch (err) {
        error = err;
      }
      expect(error?.message).to.match(/at least 8/);
    });
  });

  describe('authentication', () => {
    it('locks an account after 5 failed attempts, even for the right password', async () => {
      for (let i = 0; i < 5; i++) {
        const r = await request(app).post('/api/auth/login').send({ username: 'registrar.admin', password: 'nope' });
        expect(r.status).to.equal(401);
      }
      const locked = await request(app)
        .post('/api/auth/login')
        .send({ username: 'registrar.admin', password: 'admin12345' });
      expect(locked.status).to.equal(423);
      expect(locked.body.code).to.equal('locked');
    });

    it('gives the same error for unknown users and wrong passwords', async () => {
      const unknown = await request(app).post('/api/auth/login').send({ username: 'ghost', password: 'whatever1' });
      const wrong = await request(app)
        .post('/api/auth/login')
        .send({ username: 'registrar.admin', password: 'whatever1' });
      expect(unknown.status).to.equal(401);
      expect(unknown.body).to.deep.equal(wrong.body);
    });

    const tryToken = (t) =>
      request(app).post('/api/credentials').set('Authorization', `Bearer ${t}`).send(STUDENT);

    it('rejects unsigned (alg=none), wrongly-signed and expired tokens', async () => {
      const claims = { role: 'admin', sub: 'registrar.admin', iss: 'chain-of-record', aud: 'chain-of-record-api' };
      const unsigned = jwt.sign(claims, null, { algorithm: 'none' });
      const wrongKey = jwt.sign(claims, 'attacker-secret');
      const expired = jwt.sign({ ...claims, exp: Math.floor(Date.now() / 1000) - 60 }, 'test-secret');
      const wrongAudience = jwt.sign({ ...claims, aud: 'other-app' }, 'test-secret');
      for (const t of [unsigned, wrongKey, expired, wrongAudience]) {
        expect((await tryToken(t)).status).to.equal(401);
      }
      expect(await registry.totalIssued()).to.equal(0n);
    });

    it('issues tokens with issuer, audience, expiry and a unique id', async () => {
      const decoded = jwt.decode(token);
      expect(decoded.iss).to.equal('chain-of-record');
      expect(decoded.aud).to.equal('chain-of-record-api');
      expect(decoded.exp - decoded.iat).to.equal(3600);
      expect(decoded.jti).to.be.a('string');
    });

    it('blocks students from admin-only endpoints', async () => {
      const studentToken = await login(app, 'ananya', 'student12345');
      for (const [method, path] of [
        ['get', '/api/credentials'],
        ['get', '/api/admin/audit'],
        ['post', '/api/admin/pause'],
        ['post', '/api/credentials/batch'],
      ]) {
        const res = await request(app)[method](path).set('Authorization', `Bearer ${studentToken}`).send({});
        expect(res.status, `${method} ${path}`).to.equal(403);
      }
    });
  });

  describe('HTTP hardening', () => {
    it('sends security headers and hides the framework', async () => {
      const res = await request(app).get('/api/health');
      expect(res.headers['x-content-type-options']).to.equal('nosniff');
      expect(res.headers['strict-transport-security']).to.be.a('string');
      expect(res.headers['content-security-policy']).to.be.a('string');
      expect(res.headers['x-frame-options']).to.equal('SAMEORIGIN');
      expect(res.headers['x-powered-by']).to.equal(undefined);
    });

    it('rate-limits login attempts per IP', async () => {
      const limited = await buildApp(registry, { rateLimits: true });
      let last;
      for (let i = 0; i < 21; i++) {
        last = await request(limited).post('/api/auth/login').send({ username: `u${i}`, password: 'x' });
      }
      expect(last.status).to.equal(429);
      expect(last.body.code).to.equal('rate_limited');
    });

    it('validates and bounds input', async () => {
      const auth = { Authorization: `Bearer ${token}` };
      const cases = [
        { ...STUDENT, studentName: 'x'.repeat(201) },
        { ...STUDENT, issueDate: '2026-13-45' },
        { ...STUDENT, credentialId: "COR'; DROP TABLE credentials;--" },
        { ...STUDENT, txHash: 'not-a-hash' },
      ];
      for (const body of cases) {
        expect((await request(app).post('/api/credentials').set(auth).send(body)).status).to.equal(400);
      }
      const malformed = await request(app)
        .post('/api/credentials')
        .set(auth)
        .set('Content-Type', 'application/json')
        .send('{"broken":');
      expect(malformed.status).to.equal(400);
      const huge = await request(app)
        .post('/api/verify/file')
        .set('Content-Type', 'application/pdf')
        .send(Buffer.alloc(6 * 1024 * 1024, 0x25));
      expect(huge.status).to.equal(413);
    });

    it('returns JSON 404 for unknown API routes', async () => {
      const res = await request(app).get('/api/does-not-exist');
      expect(res.status).to.equal(404);
      expect(res.body.error).to.equal('Not found.');
    });
  });

  describe('audit log', () => {
    it('records logins, failed logins, issuance and revocation with actor and IP', async () => {
      const store = await seededStore();
      const audited = await buildApp(registry, { store });
      await request(audited).post('/api/auth/login').send({ username: 'registrar.admin', password: 'bad' });
      const t = await login(audited, 'registrar.admin', 'admin12345');
      const issued = await request(audited).post('/api/credentials').set('Authorization', `Bearer ${t}`).send(STUDENT);
      await request(audited)
        .post(`/api/credentials/${issued.body.credentialId}/revoke`)
        .set('Authorization', `Bearer ${t}`)
        .send({ reason: 'test' });

      // Only the platform admin can read the audit log; registrars can't.
      expect((await request(audited).get('/api/admin/audit').set('Authorization', `Bearer ${t}`)).status).to.equal(403);
      const p = await login(audited, 'platform.admin', 'platform12345');
      const log = (await request(audited).get('/api/admin/audit').set('Authorization', `Bearer ${p}`)).body;
      expect(log.map((e) => e.action)).to.deep.equal([
        'login',
        'credential_revoked',
        'credential_issued',
        'login',
        'login_failed',
      ]);
      expect(log[0].actor).to.equal('platform.admin');
      expect(log[1].actor).to.equal('registrar.admin');
      expect(log[1].ip).to.be.a('string');
      expect(log[2].target).to.equal(issued.body.credentialId);
    });
  });

  describe('emergency pause', () => {
    it('blocks issuance while paused but keeps verification working', async () => {
      const auth = { Authorization: `Bearer ${token}` };
      const platform = { Authorization: `Bearer ${await login(app, 'platform.admin', 'platform12345')}` };
      const issued = await request(app).post('/api/credentials').set(auth).send(STUDENT);

      expect((await request(app).post('/api/admin/pause').set(auth).send({ paused: true })).status).to.equal(403);
      const pause = await request(app).post('/api/admin/pause').set(platform).send({ paused: true });
      expect(pause.status).to.equal(200);
      expect((await request(app).get('/api/health')).body.paused).to.equal(true);

      const blocked = await request(app)
        .post('/api/credentials')
        .set(auth)
        .send({ ...STUDENT, studentName: 'Another Student' });
      expect(blocked.status).to.equal(423);
      expect(blocked.body.code).to.equal('EnforcedPause');

      const verify = await request(app).get(`/api/verify/${issued.body.credentialId}`);
      expect(verify.body.status).to.equal('valid');

      await request(app).post('/api/admin/pause').set(platform).send({ paused: false });
      const resumed = await request(app)
        .post('/api/credentials')
        .set(auth)
        .send({ ...STUDENT, studentName: 'Another Student' });
      expect(resumed.status).to.equal(201);
    });
  });

  describe('contract ownership', () => {
    it('requires the new owner to accept a transfer (two-step)', async () => {
      const [owner, next, outsider] = await ethers.getSigners();
      await registry.transferOwnership(next.address);
      expect(await registry.owner()).to.equal(owner.address);
      await expect(registry.connect(outsider).acceptOwnership()).to.be.revertedWithCustomError(
        registry,
        'OwnableUnauthorizedAccount'
      );
      await registry.connect(next).acceptOwnership();
      expect(await registry.owner()).to.equal(next.address);
      await expect(registry.connect(owner).pause()).to.be.revertedWithCustomError(
        registry,
        'OwnableUnauthorizedAccount'
      );
    });
  });

  describe('startup configuration', () => {
    const prod = {
      NODE_ENV: 'production',
      DATABASE_URL: 'postgres://x',
      JWT_SECRET: 'a'.repeat(48),
      ISSUER_PRIVATE_KEY: '0x' + '11'.repeat(32),
      CORS_ORIGIN: 'https://blockchain-ecru-three.vercel.app',
      CHAIN_NETWORK: 'sepolia',
      WALLET_ENCRYPTION_KEY: 'ab'.repeat(32),
    };

    it('accepts a complete production configuration', () => {
      expect(loadConfig(prod).errors).to.deep.equal([]);
    });

    it('refuses unsafe production settings', () => {
      const cases = {
        'weak JWT secret': { JWT_SECRET: 'short' },
        'no database': { DATABASE_URL: '' },
        'memory store': { USE_MEMORY_STORE: 'true' },
        'dev key': { ISSUER_PRIVATE_KEY: HARDHAT_DEV_KEY },
        'open CORS': { CORS_ORIGIN: '' },
        'no wallet encryption key': { WALLET_ENCRYPTION_KEY: '' },
      };
      for (const [name, override] of Object.entries(cases)) {
        expect(loadConfig({ ...prod, ...override }).errors, name).to.not.be.empty;
      }
    });

    it('requires TLS for Supabase and refuses unverified TLS in production', () => {
      const supabase = 'postgresql://postgres.abc:pw@aws-0-ap-south-1.pooler.supabase.com:5432/postgres';
      expect(databaseSslFromEnv({ DATABASE_URL: supabase }).errors).to.not.be.empty;
      expect(databaseSslFromEnv({ DATABASE_URL: supabase, DATABASE_SSL: 'no-verify' }).ssl).to.deep.equal({
        rejectUnauthorized: false,
      });
      expect(databaseSslFromEnv({ DATABASE_URL: supabase, DATABASE_SSL_CA: '/nonexistent.crt' }).errors[0]).to.match(
        /Cannot read DATABASE_SSL_CA/
      );
      expect(loadConfig({ ...prod, DATABASE_URL: supabase, DATABASE_SSL: 'no-verify' }).errors.join(' ')).to.match(
        /not allowed in production/
      );
      expect(databaseSslFromEnv({ DATABASE_URL: 'postgres://chain:chain@localhost:5544/db' }).ssl).to.equal(undefined);
    });

    it('never uses the dev key on a public network, even outside production', () => {
      const { errors } = loadConfig({
        CHAIN_NETWORK: 'sepolia',
        DATABASE_URL: 'postgres://x',
        ISSUER_PRIVATE_KEY: HARDHAT_DEV_KEY,
      });
      expect(errors.join(' ')).to.match(/public network/);
    });
  });
});
