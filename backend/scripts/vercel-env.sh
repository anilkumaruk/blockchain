#!/usr/bin/env bash
# Copies the production configuration from backend/.env into the linked Vercel
# project. Run it yourself from the repo root:   bash backend/scripts/vercel-env.sh
# Values are piped to the Vercel CLI and never printed.
set -euo pipefail
cd "$(dirname "$0")/../.."
set -a; source backend/.env; set +a

SITE_URL="${SITE_URL:-https://blockchain-ecru-three.vercel.app}"
put() { # name value
  vercel env rm "$1" production -y >/dev/null 2>&1 || true
  printf '%s' "$2" | vercel env add "$1" production >/dev/null
  echo "  set $1"
}

: "${DATABASE_URL:?missing in backend/.env}"; : "${DEPLOYER_PRIVATE_KEY:?missing}"; : "${SEPOLIA_RPC_URL:?missing}"
: "${JWT_SECRET:?missing}"; : "${WALLET_ENCRYPTION_KEY:?missing}"

put NODE_ENV production
put CHAIN_NETWORK sepolia
put RPC_URL "$SEPOLIA_RPC_URL"
put ISSUER_PRIVATE_KEY "$DEPLOYER_PRIVATE_KEY"
put DATABASE_URL "$DATABASE_URL"
put DATABASE_SSL_CA_PEM "$(cat "backend/${DATABASE_SSL_CA:-certs/prod-ca-2021.crt}")"
put DATABASE_POOL_MAX 3
put JWT_SECRET "$JWT_SECRET"
put WALLET_ENCRYPTION_KEY "$WALLET_ENCRYPTION_KEY"
put INSTITUTION_NAME "${INSTITUTION_NAME:-Alliance University}"
put INSTITUTION_FUNDING_ETH "${INSTITUTION_FUNDING_ETH:-0.003}"
put CORS_ORIGIN "$SITE_URL"
put TRUST_PROXY 1
put VITE_API_URL /
echo "Done. Deploy with: vercel --prod"
