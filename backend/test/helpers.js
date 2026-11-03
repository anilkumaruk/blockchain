// Shared test setup: an API instance backed by an in-memory store with two
// accounts, talking to whatever registry contract the test deployed.

import crypto from 'node:crypto';
import hre from 'hardhat';
import request from 'supertest';
import { createChainBridge } from '../server/chain.js';
import { createMemoryStore } from '../server/store.js';
import { createAuth } from '../server/auth.js';
import { createApp } from '../server/app.js';
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

export async function seededStore() {
  const store = createMemoryStore();
  // The root institution exists, as it does in a deployed database; its wallet
  // address is filled in from the contract owner on first use.
  await store.createInstitution({ id: 'alliance-university', name: 'Alliance University', status: 'approved' });
  // Alliance University's registrar is an ordinary university account...
  await store.createUser({
    username: 'registrar.admin',
    passwordHash: ADMIN_HASH,
    role: 'institution',
    institutionId: 'alliance-university',
  });
  // ...and the platform admin (institution approvals, registry, audit) is separate.
  await store.createUser({ username: 'platform.admin', passwordHash: PLATFORM_HASH, role: 'admin' });
  await store.createUser({
    username: 'ananya',
    passwordHash: STUDENT_HASH,
    role: 'student',
    studentId: 'RGIT21CS014',
  });
  return store;
}

export const TEST_WALLET_KEY = crypto.createHash('sha256').update('test-wallet-key').digest();

export async function buildApp(contract, { store, rateLimits = false, ...options } = {}) {
  store ??= await seededStore();
  return createApp({
    chain: createChainBridge(contract, options),
    connect: (privateKey) =>
      createChainBridge(contract.connect(new hre.ethers.Wallet(privateKey, hre.ethers.provider)), options),
    walletKey: TEST_WALLET_KEY,
    store,
    auth: createAuth({ jwtSecret: 'test-secret', store }),
    institutionName: 'Alliance University',
    rateLimits,
  });
}

export async function login(app, username, password) {
  const res = await request(app).post('/api/auth/login').send({ username, password });
  return res.body.token;
}
