// Reads and validates environment configuration. In production the server
// refuses to start with unsafe settings instead of silently falling back.

import fs from 'node:fs';
import path from 'node:path';

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
    // Which deployments/<network>.json the contract address comes from.
    network,
    // Read-only access to the contract. On Sepolia prefer SEPOLIA_RPC_URL, so a
    // local RPC_URL in .env can't leak into a testnet run.
    rpcUrl: (network === 'sepolia' && env.SEPOLIA_RPC_URL) || env.RPC_URL || 'http://127.0.0.1:8545',
    databaseUrl: env.DATABASE_URL || null,
    useMemoryStore: env.USE_MEMORY_STORE === 'true',
    jwtSecret: env.JWT_SECRET || (production ? null : DEV_JWT_SECRET),
    tokenTtl: env.JWT_TTL || '1h',
    corsOrigin: env.CORS_ORIGIN ? env.CORS_ORIGIN.split(',').map((s) => s.trim()) : production ? null : true,
    trustProxy: env.TRUST_PROXY ? Number(env.TRUST_PROXY) || env.TRUST_PROXY : false,
    // Pinata JWT for IPFS. Unset: certificates are not copied to IPFS, and
    // verification works from the smart contract alone.
    pinataJwt: env.PINATA_JWT || null,
    ipfsGateway: env.IPFS_GATEWAY || undefined,
    bootstrapAdmin: {
      username: env.ADMIN_USERNAME || 'platform.admin',
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
  if (!['localhost', 'sepolia'].includes(network)) errors.push('CHAIN_NETWORK must be localhost or sepolia.');
  // Every transaction is signed in MetaMask; a key here would only be a liability.
  for (const name of ['ISSUER_PRIVATE_KEY', 'WALLET_ENCRYPTION_KEY']) {
    if (env[name]) warnings.push(`${name} is set but no longer used: the server holds no keys. Remove it.`);
  }
  if (!config.pinataJwt) warnings.push('PINATA_JWT is not set: certificates are not copied to IPFS.');

  if (production) {
    if (config.useMemoryStore) errors.push('USE_MEMORY_STORE is not allowed in production.');
    if (!config.jwtSecret || config.jwtSecret.length < 32) {
      errors.push('JWT_SECRET must be set to at least 32 random characters in production.');
    }
    if (!config.corsOrigin) errors.push('CORS_ORIGIN must list the allowed frontend origin(s) in production.');
  } else if (config.jwtSecret === DEV_JWT_SECRET) {
    warnings.push('Using the built-in dev JWT secret.');
  }

  return { config, errors, warnings };
}
