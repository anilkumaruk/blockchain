// Builds a fully wired API app from configuration and a registry deployment.
// Shared by the local server (server/index.js) and the Vercel serverless
// function (api/index.js at the repo root).

import { createPublicAnchor } from './anchor.js';
import { createLedger, createMemoryLedgerStore, createPgLedgerStore, deriveValidatorKeys } from './ledger.js';
import { createMemoryStore, createPgStore } from './store.js';
import { createAuth } from './auth.js';
import { hashPassword } from './passwords.js';
import { createApp } from './app.js';

/** The project's own blockchain, stored in the same database. */
export function createLedgerFor(config, store, { onCommit } = {}) {
  return createLedger({
    onCommit,
    ledgerStore: store.kind === 'postgres' ? createPgLedgerStore(store) : createMemoryLedgerStore(),
    authorityKey: config.issuerKey,
    validatorKeys: deriveValidatorKeys(config.walletKey),
    chainName: 'Chain of Record',
    rootIssuerName: config.institutionName,
  });
}

/**
 * @param {ReturnType<import('./config.js').loadConfig>['config']} config
 * @param {{ bootstrapAdmin?: boolean, deployment?: object }} [options]
 *        deployment: the Sepolia contract; when set, new blocks are anchored there.
 */
export async function createRuntime(config, { bootstrapAdmin = true, deployment } = {}) {
  const store = config.useMemoryStore
    ? createMemoryStore()
    : await createPgStore(config.databaseUrl, { ssl: config.databaseSsl });

  // First run: create the registrar account so the system is usable. In
  // production ADMIN_PASSWORD must be supplied; afterwards use scripts/create-user.js.
  if (bootstrapAdmin && (await store.countUsers()) === 0) {
    const { username, password } = config.bootstrapAdmin;
    if (!password) throw new Error('No users exist yet: set ADMIN_PASSWORD to create the first admin.');
    await store.createUser({ username, passwordHash: await hashPassword(password), role: 'admin' });
    console.log(`  created initial admin account "${username}"`);
  }

  const anchor = deployment
    ? createPublicAnchor({ rpcUrl: config.rpcUrl, privateKey: config.issuerKey, deployment })
    : null;
  const ledger = createLedgerFor(config, store, { onCommit: anchor?.bestEffort });
  const app = createApp({
    chain: ledger.bridge(config.issuerKey),
    // Each approved institution signs its transactions with its own key.
    connect: (privateKey) => ledger.bridge(privateKey),
    ledger,
    walletKey: config.walletKey,
    fundingWei: config.fundingWei,
    store,
    auth: createAuth({ jwtSecret: config.jwtSecret, store, tokenTtl: config.tokenTtl }),
    institutionName: config.institutionName,
    trustedIssuer: config.trustedIssuer,
    corsOrigin: config.corsOrigin,
    trustProxy: config.trustProxy,
  });

  return { app, store, ledger };
}
