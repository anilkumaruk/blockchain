// Builds a fully wired API app from configuration and a contract deployment.
// Shared by the local server (server/index.js) and the Vercel serverless
// function (api/index.js at the repo root).

import { Contract, JsonRpcProvider } from 'ethers';
import { createChainBridge } from './chain.js';
import { createIpfs } from './ipfs.js';
import { createMemoryStore, createPgStore } from './store.js';
import { createAuth } from './auth.js';
import { hashPassword } from './passwords.js';
import { createApp } from './app.js';

const EXPLORERS = { sepolia: 'https://sepolia.etherscan.io' };

/** Read-only access to the CredentialRegistry contract: no private key. */
export function connectContract(config, deployment) {
  const provider = new JsonRpcProvider(config.rpcUrl, deployment.chainId, { staticNetwork: true });
  const contract = new Contract(deployment.address, deployment.abi, provider);
  return createChainBridge(contract, { fromBlock: deployment.blockNumber ?? 0 });
}

/**
 * @param {ReturnType<import('./config.js').loadConfig>['config']} config
 * @param {{ bootstrapAdmin?: boolean, deployment: { address: string, abi: object[], chainId: number, blockNumber?: number } }} options
 *        deployment: deployments/<network>.json, written by scripts/deploy.js
 */
export async function createRuntime(config, { bootstrapAdmin = true, deployment }) {
  if (!deployment?.address) throw new Error(`No contract deployment for "${config.network}". Run npm run deploy:${config.network === 'sepolia' ? 'sepolia' : 'local'}.`);
  const store = config.useMemoryStore ? createMemoryStore() : await createPgStore(config.databaseUrl, { ssl: config.databaseSsl });

  // First run: create the platform admin so the system is usable. In
  // production ADMIN_PASSWORD must be supplied; afterwards use scripts/create-user.js.
  if (bootstrapAdmin && (await store.countUsers()) === 0) {
    const { username, password } = config.bootstrapAdmin;
    if (!password) throw new Error('No users exist yet: set ADMIN_PASSWORD to create the first admin.');
    await store.createUser({ username, passwordHash: await hashPassword(password), role: 'admin' });
    console.log(`  created platform admin account "${username}"`);
  }

  const chain = connectContract(config, deployment);
  const app = createApp({
    chain,
    store,
    auth: createAuth({ jwtSecret: config.jwtSecret, store, tokenTtl: config.tokenTtl }),
    ipfs: createIpfs({ jwt: config.pinataJwt, gateway: config.ipfsGateway }),
    network: { name: config.network, chainId: deployment.chainId, explorer: EXPLORERS[config.network] ?? null },
    corsOrigin: config.corsOrigin,
    trustProxy: config.trustProxy,
  });
  return { app, store, chain };
}
