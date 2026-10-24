// Copies the production configuration from backend/.env into the linked Vercel
// project (production environment). Run it yourself from the repo root:
//
//   node backend/scripts/vercel-env.js
//
// Values are passed to the Vercel CLI on stdin and never printed.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const backend = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.join(backend, '..');
const env = dotenv.parse(fs.readFileSync(path.join(backend, '.env')));
const SITE_URL = process.env.SITE_URL || 'https://blockchain-ecru-three.vercel.app';

const required = ['DATABASE_URL', 'DEPLOYER_PRIVATE_KEY', 'SEPOLIA_RPC_URL', 'JWT_SECRET', 'WALLET_ENCRYPTION_KEY'];
const missing = required.filter((k) => !env[k]);
if (missing.length) {
  console.error(`Missing in backend/.env: ${missing.join(', ')}`);
  process.exit(1);
}
const caFile = path.join(backend, env.DATABASE_SSL_CA || 'certs/prod-ca-2021.crt');

const values = {
  NODE_ENV: 'production',
  CHAIN_NETWORK: 'sepolia',
  RPC_URL: env.SEPOLIA_RPC_URL,
  ISSUER_PRIVATE_KEY: env.DEPLOYER_PRIVATE_KEY,
  DATABASE_URL: env.DATABASE_URL,
  DATABASE_SSL_CA_PEM: fs.readFileSync(caFile, 'utf8'),
  DATABASE_POOL_MAX: '3',
  JWT_SECRET: env.JWT_SECRET,
  WALLET_ENCRYPTION_KEY: env.WALLET_ENCRYPTION_KEY,
  INSTITUTION_NAME: env.INSTITUTION_NAME || 'Alliance University',
  INSTITUTION_FUNDING_ETH: env.INSTITUTION_FUNDING_ETH || '0.001',
  CORS_ORIGIN: SITE_URL,
  TRUST_PROXY: '1',
  VITE_API_URL: '/',
};

const vercel = (args, input) =>
  spawnSync('vercel', args, { cwd: repoRoot, input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });

for (const [name, value] of Object.entries(values)) {
  vercel(['env', 'rm', name, 'production', '-y']); // replace any old value
  const r = vercel(['env', 'add', name, 'production'], value);
  if (r.status !== 0) {
    console.error(`  FAILED ${name}: ${(r.stderr || r.stdout).trim().split('\n').pop()}`);
    process.exit(1);
  }
  console.log(`  set ${name}`);
}
console.log('Done. Tell Claude "env done".');
