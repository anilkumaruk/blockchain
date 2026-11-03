// Shared test setup: a CredentialRegistry on Hardhat's in-process Ethereum, an
// API backed by an in-memory store, and helpers that sign transactions the way
// MetaMask would in the browser (prepare on the server, sign, then confirm).

import hre from 'hardhat';
import request from 'supertest';
import { createChainBridge } from '../server/chain.js';
import { createMemoryStore } from '../server/store.js';
import { createAuth } from '../server/auth.js';
import { createApp, normalizeReason } from '../server/app.js';
import { hashPassword } from '../server/passwords.js';

// supertest starts each app with listen(0) on every interface, then connects to
// 127.0.0.1. If another program already listens on 127.0.0.1 at the port the OS
// picked, the request reaches that program and the test fails at random. So the
// server is bound to 127.0.0.1 itself, just before the request is sent.
const { Test } = request;
const serverAddress = Test.prototype.serverAddress;
Test.prototype.serverAddress = function (app, path) {
  if (app.address()) return serverAddress.call(this, app, path);
  this.unboundPath = path;
  return `http://127.0.0.1${path}`; // replaced once the server is listening
};
const end = Test.prototype.end;
Test.prototype.end = function (fn) {
  if (this.unboundPath === undefined) return end.call(this, fn);
  const path = this.unboundPath;
  this.unboundPath = undefined;
  this.app.listen(0, '127.0.0.1', () => {
    this._server = this.app;
    this.url = `http://127.0.0.1:${this.app.address().port}${path}`;
    end.call(this, fn);
  });
  return this;
};

const ADMIN_HASH = await hashPassword('admin12345');
const STUDENT_HASH = await hashPassword('student12345');
const PLATFORM_HASH = await hashPassword('platform12345');

/** Hardhat accounts: 0 owns the contract (platform), 1 is Alliance University's MetaMask. */
export const signers = () => hre.ethers.getSigners();

/** A fresh registry: the platform owns it, Alliance University may issue. */
export async function deployRegistry() {
  const [owner, university] = await signers();
  const registry = await hre.ethers.deployContract('CredentialRegistry', ['Chain of Record platform']);
  await registry.setIssuer(owner.address, 'Chain of Record platform', false);
  await registry.setIssuer(university.address, 'Alliance University', true);
  return registry;
}

export async function seededStore() {
  const [, university] = await signers();
  const store = createMemoryStore();
  await store.createInstitution({ id: 'alliance-university', name: 'Alliance University', status: 'approved', walletAddress: university.address });
  await store.createUser({ username: 'registrar.admin', passwordHash: ADMIN_HASH, role: 'institution', institutionId: 'alliance-university' });
  // The platform admin (institution approvals, registry, audit) belongs to no university.
  await store.createUser({ username: 'platform.admin', passwordHash: PLATFORM_HASH, role: 'admin' });
  await store.createUser({ username: 'ananya', passwordHash: STUDENT_HASH, role: 'student', studentId: 'RGIT21CS014' });
  return store;
}

export async function buildApp(contract, { store, rateLimits = false, ipfs = null, ...options } = {}) {
  store ??= await seededStore();
  return createApp({
    chain: createChainBridge(contract, options),
    store,
    auth: createAuth({ jwtSecret: 'test-secret', store }),
    ipfs,
    network: { name: 'hardhat', chainId: 31337 },
    rateLimits,
  });
}

export async function login(app, username, password) {
  const res = await request(app).post('/api/auth/login').send({ username, password });
  return res.body.token;
}

/**
 * A university at work: every write is prepared by the API, signed by `signer`
 * (standing in for the registrar's MetaMask), then confirmed by the API.
 */
export function university(app, token, signer, registry) {
  const auth = { Authorization: `Bearer ${token}` };
  const asSigner = registry.connect(signer);
  return {
    auth,
    async issue(body) {
      const prep = await request(app).post('/api/credentials/prepare').set(auth).send(body);
      if (prep.status !== 200) return prep;
      const tx = await (await asSigner.issueCredential(prep.body.credentialId, prep.body.docHash)).wait();
      return request(app)
        .post('/api/credentials')
        .set(auth)
        .send({ ...prep.body.fields, studentEmail: body.studentEmail, replaces: body.replaces, txHash: tx.hash });
    },
    async revoke(credentialId, reason) {
      const record = (await request(app).get(`/api/credentials/${credentialId}`)).body;
      const reasonHash = hre.ethers.keccak256(hre.ethers.toUtf8Bytes(normalizeReason(reason)));
      await (
        record.batch
          ? await asSigner.revokeBatchCredential(record.batch.batchId, credentialId, record.hash, record.batch.proof, reasonHash)
          : await asSigner.revokeCredential(credentialId, reasonHash)
      ).wait();
      return request(app).post(`/api/credentials/${credentialId}/revoke`).set(auth).send({ reason });
    },
    async batch(credentials) {
      const prep = await request(app).post('/api/credentials/batch/prepare').set(auth).send({ credentials });
      if (prep.status !== 200) return prep;
      const tx = await (await asSigner.anchorBatch(prep.body.root, prep.body.count)).wait();
      const batchId = Number(tx.logs.map((l) => registry.interface.parseLog(l)).find((e) => e?.name === 'BatchAnchored').args.batchId);
      return request(app).post('/api/credentials/batch').set(auth).send({ credentials: prep.body.credentials, batchId, txHash: tx.hash });
    },
  };
}
