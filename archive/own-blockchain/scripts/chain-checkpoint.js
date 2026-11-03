// Writes the chain's latest block hash into the Solidity contract on Sepolia.
//   npm run chain:checkpoint

import 'dotenv/config';
import fs from 'node:fs';
import { createPublicAnchor } from '../server/anchor.js';
import { loadConfig } from '../server/config.js';
import { createLedgerFor } from '../server/runtime.js';
import { createPgStore } from '../server/store.js';

const { config } = loadConfig();
const deployment = JSON.parse(fs.readFileSync(new URL('../deployments/sepolia.json', import.meta.url)));
const store = await createPgStore(config.databaseUrl, { ssl: config.databaseSsl });
const { blocks, headHash } = await createLedgerFor(config, store).explorer.summary();
const anchor = createPublicAnchor({ rpcUrl: process.env.SEPOLIA_RPC_URL, privateKey: process.env.DEPLOYER_PRIVATE_KEY, deployment });
console.log(`Anchoring block ${blocks - 1} (${headHash}) on Sepolia...`);
const tx = await anchor.anchor(headHash, blocks, { wait: true });
console.log(`Anchored: https://sepolia.etherscan.io/tx/${tx}`);
await store.close();
