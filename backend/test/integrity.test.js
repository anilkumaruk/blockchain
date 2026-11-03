// Integrity under concurrency, forged storage and partial failures.

import { expect } from 'chai';
import request from 'supertest';
import { merkleRoot, mine, sha256, transactionId } from '../blockchain/index.js';
import { createLedger, createMemoryLedgerStore, deriveValidatorKeys } from '../server/ledger.js';
import { createApp } from '../server/app.js';
import { createAuth } from '../server/auth.js';
import { createMemoryStore } from '../server/store.js';
import { hashPassword } from '../server/passwords.js';
import { TEST_WALLET_KEY } from './helpers.js';

const AUTHORITY = `0x${sha256('integrity-authority')}`;
const hash = (s) => sha256(s);
const options = (ledgerStore, seed = 'i') => ({
  ledgerStore,
  authorityKey: AUTHORITY,
  validatorKeys: deriveValidatorKeys(seed),
  chainName: 'T',
  rootIssuerName: 'U',
  difficulty: 2,
});

describe('Integrity', () => {
  it('keeps one valid chain when two issues arrive at the same moment', async () => {
    const ledgerStore = createMemoryLedgerStore();
    const ledger = createLedger(options(ledgerStore));
    const bridge = ledger.bridge(AUTHORITY);
    await bridge.issue('C-0', hash('c0'));
    const receipts = await Promise.all([bridge.issue('C-1', hash('c1')), bridge.issue('C-2', hash('c2'))]);
    expect(receipts[0].blockNumber).to.not.equal(receipts[1].blockNumber);

    const restarted = createLedger(options(ledgerStore));
    (await restarted.explorer.audit({ deep: true })).forEach((n) => expect(n, n.node).to.include({ valid: true, height: 3 }));
    expect((await restarted.bridge(AUTHORITY).getById('C-2')).certHash).to.equal(hash('c2'));
  });

  it('rejects a forgery written consistently into every stored copy', async () => {
    const ledgerStore = createMemoryLedgerStore();
    await createLedger(options(ledgerStore, 'f')).bridge(AUTHORITY).issue('F-1', hash('genuine'));
    // An attacker with database access rewrites block 1 in all three copies:
    // new data, recomputed id, Merkle root and proof of work. Signatures cannot be redone.
    for (const node of ['node-1', 'node-2', 'node-3']) {
      ledgerStore.corrupt(node, 1, (b) => {
        const tx = b.transactions[0];
        tx.payload.certHash = hash('forged');
        tx.id = transactionId(tx);
        const mined = mine({ ...b.header, merkleRoot: merkleRoot(b.transactions.map((t) => t.id)) });
        b.header = mined.header;
        b.hash = mined.hash;
      });
    }
    const restarted = createLedger(options(ledgerStore, 'f')).bridge(AUTHORITY);
    let answer = null;
    let error = null;
    await restarted.getById('F-1').then((a) => (answer = a), (e) => (error = e));
    expect(answer?.certHash, 'the forged hash must never be returned').to.not.equal(hash('forged'));
    expect(error?.name).to.equal('ChainUnavailableError');
  });

  it('reports the chain as unavailable, never VALID, when block storage is down', async () => {
    const ledgerStore = createMemoryLedgerStore();
    await createLedger(options(ledgerStore, 's')).bridge(AUTHORITY).issue('S-1', hash('s1'));
    const down = { ...ledgerStore, heights: async () => { throw new Error('connection refused'); }, load: async () => { throw new Error('connection refused'); } };
    let error = null;
    await createLedger(options(down, 's')).bridge(AUTHORITY).getById('S-1').catch((e) => (error = e));
    expect(error?.name).to.equal('ChainUnavailableError');
  });

  describe('database failure after the chain write', () => {
    let app, store, token, ledger;
    const CRED = { studentName: 'Asha Rao', studentId: 'AU1', credentialType: 'B.Tech', issueDate: '2026-06-15', credentialId: 'COR-2026-INT001' };
    const auth = () => ({ Authorization: `Bearer ${token}` });
    const failOnce = (name) => {
      const original = store[name];
      store[name] = async () => {
        store[name] = original;
        throw new Error('database unavailable');
      };
    };

    before(async () => {
      store = createMemoryStore();
      ledger = createLedger(options(createMemoryLedgerStore(), 'd'));
      await store.createInstitution({ id: 'u', name: 'U', status: 'approved', kind: 'university' });
      await store.createUser({ username: 'reg', passwordHash: await hashPassword('registrar1'), role: 'institution', institutionId: 'u' });
      app = createApp({
        chain: ledger.bridge(AUTHORITY),
        connect: (k) => ledger.bridge(k),
        ledger,
        walletKey: TEST_WALLET_KEY,
        store,
        auth: createAuth({ jwtSecret: 'test-secret', store }),
        institutionName: 'U',
        rateLimits: false,
      });
      token = (await request(app).post('/api/auth/login').send({ username: 'reg', password: 'registrar1' })).body.token;
    });

    it('can retry an issue whose database save failed', async () => {
      failOnce('insert');
      const first = await request(app).post('/api/credentials').set(auth()).send(CRED);
      expect(first.status).to.equal(500);
      const retry = await request(app).post('/api/credentials').set(auth()).send(CRED);
      expect(retry.status, JSON.stringify(retry.body)).to.equal(201);
      expect((await request(app).get(`/api/verify/${CRED.credentialId}`)).body.status).to.equal('valid');
    });

    it('can retry a batch whose database save failed', async () => {
      const batch = { credentials: [1, 2, 3].map((i) => ({ ...CRED, studentId: `B${i}`, credentialId: `COR-2026-BAT00${i}` })) };
      failOnce('insertMany');
      expect((await request(app).post('/api/credentials/batch').set(auth()).send(batch)).status).to.equal(500);
      const retry = await request(app).post('/api/credentials/batch').set(auth()).send(batch);
      expect(retry.status, JSON.stringify(retry.body)).to.equal(201);
      expect((await request(app).get('/api/verify/COR-2026-BAT003')).body.status).to.equal('valid');
    });

    it('still rejects an ID that is on the chain for a different certificate', async () => {
      await ledger.bridge(AUTHORITY).issue('COR-2026-INT002', `0x${'ab'.repeat(32)}`);
      const res = await request(app).post('/api/credentials').set(auth()).send({ ...CRED, credentialId: 'COR-2026-INT002' });
      expect(res.status, JSON.stringify(res.body)).to.equal(409);
    });

    it('reports an error, never VALID, when the database is down during verification', async () => {
      for (const route of [`/api/verify/${CRED.credentialId}`]) {
        failOnce('get');
        const res = await request(app).get(route);
        expect(res.status, route).to.equal(500);
        expect(res.body.status, route).to.not.equal('valid');
      }
      failOnce('findDegreeRecord');
      const photo = await request(app).post('/api/verify/photo').send({ ocrText: `Certificate No: ${CRED.credentialId}\nName: Asha Rao\n` });
      expect(photo.status).to.equal(500);
      expect(photo.body.verdict).to.equal(undefined);
    });

    it('can retry a revocation whose database save failed', async () => {
      failOnce('update');
      const first = await request(app).post(`/api/credentials/${CRED.credentialId}/revoke`).set(auth()).send({ reason: 'Error' });
      expect(first.status).to.equal(500);
      expect((await request(app).get(`/api/verify/${CRED.credentialId}`)).body.status).to.equal('revoked');
      const retry = await request(app).post(`/api/credentials/${CRED.credentialId}/revoke`).set(auth()).send({ reason: 'Error' });
      expect(retry.status, JSON.stringify(retry.body)).to.equal(200);
      expect((await store.get(CRED.credentialId)).status).to.equal('revoked');
    });
  });
});
