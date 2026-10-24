// Builds a fully wired API app from configuration and a registry deployment.
// Shared by the local server (server/index.js) and the Vercel serverless
// function (api/index.js at the repo root).

import { Contract, JsonRpcProvider, Wallet } from 'ethers';
import { createChainBridge } from './chain.js';
import { createMemoryStore, createPgStore } from './store.js';
import { createAuth } from './auth.js';
import { hashPassword } from './passwords.js';
import { createApp } from './app.js';

/**
 * @param {ReturnType<import('./config.js').loadConfig>['config']} config
 * @param {{ address: string, abi: object[], chainId: number, blockNumber?: number }} deployment
 * @param {{ bootstrapAdmin?: boolean }} [options]
 */
export async function createRuntime(config, deployment, { bootstrapAdmin = true } = {}) {
  // cacheTimeout -1: never reuse a cached nonce for back-to-back transactions.
  const provider = new JsonRpcProvider(config.rpcUrl, deployment.chainId, { staticNetwork: true, cacheTimeout: -1 });
  // The local chain mines instantly; don't wait ethers' default 4 s between receipt checks.
  if (config.network === 'localhost') provider.pollingInterval = 200;
  const signer = new Wallet(config.issuerKey, provider);
  const contract = new Contract(config.contractAddress || deployment.address, deployment.abi, signer);

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

  const bridgeOptions = { fromBlock: deployment.blockNumber ?? 0 };
  const app = createApp({
    chain: createChainBridge(contract, bridgeOptions),
    // Each approved institution signs with its own wallet on the same registry.
    connect: (privateKey) => createChainBridge(contract.connect(new Wallet(privateKey, provider)), bridgeOptions),
    walletKey: config.walletKey,
    fundingWei: config.fundingWei,
    store,
    auth: createAuth({ jwtSecret: config.jwtSecret, store, tokenTtl: config.tokenTtl }),
    institutionName: config.institutionName,
    trustedIssuer: config.trustedIssuer,
    corsOrigin: config.corsOrigin,
    trustProxy: config.trustProxy,
  });

  return { app, store, contract, signer };
}
