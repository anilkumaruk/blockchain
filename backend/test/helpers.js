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
