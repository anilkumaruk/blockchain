// Reads and validates environment configuration. In production the server
// refuses to start with unsafe settings instead of silently falling back.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { parseEther } from 'ethers';

// Hardhat's publicly known account #0 key. Fine on a local dev chain, a
// guaranteed loss of funds anywhere else.
export const HARDHAT_DEV_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const DEV_JWT_SECRET = 'dev-only-insecure-jwt-secret-change-me';

const isSupabaseHost = (url) => {
  try {
    return /\.supabase\.(co|com)$/.test(new URL(url).hostname);
  } catch {
    return false;
  }
};

/**
 * TLS settings for the PostgreSQL connection.
 *   DATABASE_SSL_CA_PEM=<pem text>   same, with the certificate text itself (Vercel)
 *   DATABASE_SSL_CA=path/to/ca.crt  verify the server against this CA (Supabase: download
 *                                   from Project Settings -> Database -> SSL Configuration)
 *   DATABASE_SSL=true               verify against the system CA store
 *   DATABASE_SSL=no-verify          encrypt but skip certificate checks (dev only)
 * Hosted Supabase databases always get TLS; plain local Postgres gets none by default.
 */
export function databaseSslFromEnv(env = process.env) {
  const errors = [];
  const warnings = [];
  let ssl;
  if (env.DATABASE_SSL_CA_PEM) {
    // Certificate text itself (hosting platforms without a file system, e.g. Vercel).
    ssl = { ca: env.DATABASE_SSL_CA_PEM.replace(/\\n/g, '\n'), rejectUnauthorized: true };
  } else if (env.DATABASE_SSL_CA) {
    try {
      ssl = { ca: fs.readFileSync(path.resolve(env.DATABASE_SSL_CA), 'utf8'), rejectUnauthorized: true };
    } catch (err) {
      errors.push(`Cannot read DATABASE_SSL_CA (${env.DATABASE_SSL_CA}): ${err.message}`);
    }
  } else if (env.DATABASE_SSL === 'true') {
    ssl = { rejectUnauthorized: true };
  } else if (env.DATABASE_SSL === 'no-verify') {
    ssl = { rejectUnauthorized: false };
    warnings.push('DATABASE_SSL=no-verify: the connection is encrypted but the server certificate is not checked.');
  } else if (isSupabaseHost(env.DATABASE_URL)) {
    errors.push(
      'Supabase requires TLS: set DATABASE_SSL_CA to the downloaded Supabase CA certificate ' +
        '(or DATABASE_SSL=no-verify for local testing only).'
    );
  }
  return { ssl, errors, warnings };
}

export function loadConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const network = env.CHAIN_NETWORK || 'localhost';
  const errors = [];
  const warnings = [];

  const config = {
    production,
    port: Number(env.PORT || 4000),
    network,
    // On Sepolia prefer SEPOLIA_RPC_URL, so a local RPC_URL in .env can't leak into a testnet run.
    rpcUrl: (network === 'sepolia' && env.SEPOLIA_RPC_URL) || env.RPC_URL || 'http://127.0.0.1:8545',
    contractAddress: env.CONTRACT_ADDRESS || null,
    // On a public network the deployer (contract owner) is the platform's issuer by default.
    issuerKey:
      env.ISSUER_PRIVATE_KEY || (network === 'localhost' ? HARDHAT_DEV_KEY : env.DEPLOYER_PRIVATE_KEY || null),
    trustedIssuer: env.TRUSTED_ISSUER_ADDRESS || undefined,
    databaseUrl: env.DATABASE_URL || null,
    useMemoryStore: env.USE_MEMORY_STORE === 'true',
    jwtSecret: env.JWT_SECRET || (production ? null : DEV_JWT_SECRET),
    tokenTtl: env.JWT_TTL || '1h',
    corsOrigin: env.CORS_ORIGIN ? env.CORS_ORIGIN.split(',').map((s) => s.trim()) : production ? null : true,
    trustProxy: env.TRUST_PROXY ? Number(env.TRUST_PROXY) || env.TRUST_PROXY : false,
    institutionName: env.INSTITUTION_NAME || 'Alliance University',
    // 32-byte key (64 hex chars) that encrypts each institution's issuer wallet.
    walletKey: /^[0-9a-f]{64}$/i.test(env.WALLET_ENCRYPTION_KEY ?? '')
      ? Buffer.from(env.WALLET_ENCRYPTION_KEY, 'hex')
      : production
        ? null
        : crypto.createHash('sha256').update('chain-of-record-dev-wallet-key').digest(),
    // ETH sent to a newly approved institution so it can pay gas.
    fundingWei: parseEther(env.INSTITUTION_FUNDING_ETH || (network === 'localhost' ? '1' : '0.02')),
    bootstrapAdmin: {
      username: env.ADMIN_USERNAME || 'registrar.admin',
      password: env.ADMIN_PASSWORD || (production ? null : 'admin12345'),
    },
  };

  if (config.databaseUrl) {
    const db = databaseSslFromEnv(env);
    config.databaseSsl = db.ssl;
    errors.push(...db.errors);
    warnings.push(...db.warnings);
    if (production && db.ssl?.rejectUnauthorized === false) {
      errors.push('DATABASE_SSL=no-verify is not allowed in production; use DATABASE_SSL_CA.');
    }
  }
  if (!config.databaseUrl && !config.useMemoryStore) {
    errors.push('DATABASE_URL is required (or set USE_MEMORY_STORE=true for a throwaway demo).');
  }
  if (config.useMemoryStore) warnings.push('USE_MEMORY_STORE=true: data is lost when the server stops.');
  if (env.WALLET_ENCRYPTION_KEY && !/^[0-9a-f]{64}$/i.test(env.WALLET_ENCRYPTION_KEY)) {
    errors.push('WALLET_ENCRYPTION_KEY must be 64 hex characters (openssl rand -hex 32).');
  } else if (!env.WALLET_ENCRYPTION_KEY) {
    if (production) errors.push('WALLET_ENCRYPTION_KEY is required in production (openssl rand -hex 32).');
    else warnings.push('Using the built-in dev WALLET_ENCRYPTION_KEY; institution wallet keys are not safely encrypted.');
  }
  if (!config.issuerKey) errors.push(`ISSUER_PRIVATE_KEY is required for network "${network}".`);

  if (production) {
    if (config.useMemoryStore) errors.push('USE_MEMORY_STORE is not allowed in production.');
    if (!config.jwtSecret || config.jwtSecret.length < 32) {
      errors.push('JWT_SECRET must be set to at least 32 random characters in production.');
    }
    if (config.issuerKey === HARDHAT_DEV_KEY) errors.push('The Hardhat dev key must never be used in production.');
    if (!config.corsOrigin) errors.push('CORS_ORIGIN must list the allowed frontend origin(s) in production.');
  } else {
    if (config.jwtSecret === DEV_JWT_SECRET) warnings.push('Using the built-in dev JWT secret.');
  }
  if (network !== 'localhost' && config.issuerKey === HARDHAT_DEV_KEY) {
    errors.push('The Hardhat dev key cannot be used on a public network.');
  }

  return { config, errors, warnings };
}
