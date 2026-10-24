# Chain of Record — Blockchain-Based Verifiable Academic Credential System

E1CSA313 Design Project-1, Alliance University  
Team: Manu M P, Tarun Kumar S, Anilkumar U K, Pruthviraj D N · Mentor: Dr. Saravanan P

A blockchain-backed verification layer on top of a university's academic records.
At issuance, the SHA-256 fingerprint of each certificate is anchored in a Solidity
registry. Anyone can then verify a certificate by credential ID, QR code or PDF
upload, without contacting the university.

- Live frontend demo (in-browser mock mode): https://blockchain-ecru-three.vercel.app

## Architecture

```
React (Vite) ──REST──▶ Node.js + Express ──ethers.js──▶ CredentialRegistry.sol
 Admin Console          JWT + RBAC, helmet,              (Hardhat / Sepolia)
 Student Portal         rate limits, audit log           individual: hash · issuer · status
 Verification UI        SHA-256 + Merkle trees           batch: one Merkle root per class
                        ──▶ PostgreSQL (records, users, audit log)
```

## Blockchain features

| Feature | What it does |
|---|---|
| Individual issuance | One credential per transaction: SHA-256 hash, issuer, timestamps, status (~125k gas) |
| **Merkle batch issuance** | A whole class in one transaction: only the Merkle root goes on-chain; each student keeps a proof. 500 credentials ≈ 212 gas each (0.17% of individual) |
| Revocation | A state change, never a deletion; works for individual and batch credentials |
| **On-chain audit trail** | `GET /api/credentials/:id/history` reads `CredentialIssued` / `BatchAnchored` / `CredentialRevoked` events |
| Multi-issuer governance | Owner authorizes or deactivates issuer addresses; verification trusts only this university's issuer |
| **Emergency pause** | OpenZeppelin `Pausable`: blocks issue/revoke after a key compromise, verification keeps working |
| **Two-step ownership** | OpenZeppelin `Ownable2Step`: the new owner must accept, so a typo can't lose the contract |

See [SECURITY.md](SECURITY.md) for the threat model and all security controls.

## Accounts: institutions and students

- **Platform admin** (`registrar.admin`, the contract owner, Alliance University) approves institutions,
  and is the only account that sees every credential, the audit log and the pause control.
- **Institutions** register at `/register/institution` and stay *pending* until the admin approves them.
  Approval creates the institution's own issuer wallet (encrypted with `WALLET_ENCRYPTION_KEY`),
  authorizes it on-chain with `setIssuer`, and funds it for gas. Its credentials are then recorded
  on-chain under its own address. Suspending it makes them fail verification (`untrusted_issuer`).
- **Students** sign in at `/student` with their personal email. They can create an account only for an
  email their institution has on record (entered as "Student personal email" when issuing), and see
  only their own credentials.

## Dataset: Fluree Academic Credentials

`backend/data/fluree-acd` holds the MIT-licensed [Fluree ACD](https://github.com/fluree/dataset-academic-credentials).
`npm run import:fluree` loads its 11 issuing institutions, 2 employers, 3 students and 51 credentials into
the database and anchors every credential on-chain under its institution's wallet. It is safe to re-run.
Imported students can register with their dataset emails (e.g. `freddyyeti1@fluree.edu`).

| Data | Where | Why |
|---|---|---|
| SHA-256 of certificate, issuer address, issued/revoked time, status | On-chain | Tamper-evident, publicly verifiable |
| Student name, ID, course, dates, revocation reason text | Off-chain (PostgreSQL) | Privacy; only `keccak256(reason)` goes on-chain |
| Certificate PDF | Generated deterministically from the record | Re-hashing it must reproduce the on-chain hash |

The **chain is the source of truth** for hash and status. The off-chain record is
cross-checked against it on every verification, so tampering with the database
is detected too (`record_mismatch`).

## Repository layout

```
src/                    React frontend (Admin Console, Student Portal, Verification UI)
  lib/api.js            Switch: real backend if VITE_API_URL is set, else in-browser mock
  lib/httpApi.js        Backend client
  lib/mockApi.js        In-browser mock (used by the Vercel demo)
backend/
  contracts/CredentialRegistry.sol   Solidity registry (issue / revoke / verify)
  server/               Express API: app.js, auth.js (JWT+RBAC), chain.js (ethers bridge),
                        store.js (PostgreSQL), merkle.js, passwords.js (scrypt), config.js
  server/migrations/    Versioned SQL schema (credentials, users, audit_log)
  test/                 Contract, Merkle batch, security, PostgreSQL and Review-1 scenario tests
  scripts/              deploy.js, seed.js, benchmark.js, create-user.js
  results/benchmark.md  Latest performance evaluation
```

## Running the full stack locally

```bash
# 1. Backend dependencies
cd backend && npm install --legacy-peer-deps

cp .env.example .env      # then set ADMIN_PASSWORD (and JWT_SECRET)

# 2. PostgreSQL (Docker) and a local blockchain (terminal 1)
npm run db:up
npm run chain

# 3. Deploy the registry, start the API, seed demo data (terminal 2)
npm run deploy:local
npm start                 # runs DB migrations, creates the first admin, http://localhost:4000
npm run seed              # issues the 8 demo credentials (2 revoked) on-chain

# 4. Frontend against the real backend (terminal 3, repo root)
VITE_API_URL=http://localhost:4000 npm run dev
```

Sign in as `registrar.admin` with the `ADMIN_PASSWORD` from `backend/.env`.
More accounts: `npm run create-user -- <username> <admin|student> [studentId]`
(prompts for the password, stores an scrypt hash).

**Supabase database:**

1. In Supabase, open **Connect** and copy the **Session pooler** connection string.
   The direct `db.<ref>.supabase.co` host is IPv6-only and fails on most home networks.
2. Under **Project Settings → Database → SSL Configuration**, download the CA certificate
   and save it as `backend/certs/prod-ca-2021.crt`. The `certs/` folder is git-ignored.
3. In `backend/.env`, set:
   ```
   DATABASE_URL=postgresql://postgres.<project-ref>:<db-password>@aws-0-<region>.pooler.supabase.com:5432/postgres
   DATABASE_SSL_CA=certs/prod-ca-2021.crt
   ```
4. Run `npm run db:check`. It connects over verified TLS, runs the migrations and
   shows that Row Level Security is on for every table.

Migration `002` enables Row Level Security and revokes access for the `anon` and
`authenticated` roles. Supabase's public REST API then can't read student records,
password hashes or the audit log, even with the project's public anon key. Only this
API server, which connects as the database owner, can access the tables.

Other hosted Postgres (Neon, RDS): set `DATABASE_URL` and `DATABASE_SSL=true`.

**Sepolia testnet:** set `SEPOLIA_RPC_URL` and `DEPLOYER_PRIVATE_KEY` in `backend/.env`,
run `npm run deploy:sepolia`, then start the API with `CHAIN_NETWORK=sepolia`,
`RPC_URL=<same RPC>` and `ISSUER_PRIVATE_KEY=<deployer key>`. Use a fresh wallet
funded only with Sepolia test ETH, and never commit `.env`.

**Production** (`NODE_ENV=production`): the server refuses to start without a
database, a ≥32-character `JWT_SECRET`, a `CORS_ORIGIN` allowlist and a real issuer key.

## REST API

| Method | Path | Role | Purpose |
|---|---|---|---|
| POST | `/api/auth/login` | – | Email or username; returns a JWT (`admin`, `institution` or `student`) |
| POST | `/api/auth/register/student` | – | Student account for an email an institution has on record |
| POST | `/api/institutions/register` | – | Institution application (pending until approved) |
| GET | `/api/institutions` | – | Public directory of approved issuers |
| GET | `/api/me`, `/api/me/credentials` | signed in / student | Own profile and credentials |
| GET | `/api/admin/institutions` | admin | All institutions |
| POST | `/api/admin/institutions/:id/approve` · `reject` · `suspend` | admin | Institution lifecycle (approve creates and authorizes its wallet) |
| POST | `/api/credentials` | admin, institution | Hash certificate, anchor on-chain under the issuer's wallet, store record (optional `studentEmail`) |
| GET | `/api/credentials` | admin | List all records |
| POST | `/api/credentials/:id/revoke` | admin | On-chain status change (no deletion) |
| POST | `/api/credentials/:id/reissue` | admin | Revoke + issue corrected credential, linked both ways |
| POST | `/api/credentials/batch` | admin | Merkle batch: up to 500 credentials in one transaction |
| GET | `/api/credentials/:id/history` | – | On-chain event trail (issued / anchored / revoked) |
| GET | `/api/admin/audit` | admin | Audit log (logins, failed logins, issue, revoke, pause) |
| GET | `/api/admin/registry` | admin | Contract address, owner, trusted issuer, paused state |
| POST | `/api/admin/pause` | admin | Emergency stop / resume (`{ "paused": true }`) |
| GET | `/api/students/:studentId/credentials` | – | Student portal / shared profile |
| GET | `/api/verify/:credentialId` | – | Verify by ID / QR |
| POST | `/api/verify/hash` | – | Verify a client-computed SHA-256 |
| POST | `/api/verify/file` | – | Upload PDF; server recomputes SHA-256 |
| GET | `/api/health` | – | Chain + store status |

Verification returns `status` (`valid` / `revoked` / `invalid` / `unavailable`) and a
precise `code` (`not_found`, `hash_mismatch`, `untrusted_issuer`, `record_mismatch`, `chain_unavailable`).

## Testing and evaluation

```bash
cd backend
npm test            # 53 tests: contract, Merkle batch, security, 10 Review-1 scenarios
npm run test:db     # + 6 PostgreSQL integration tests (needs npm run db:up)
npm run benchmark   # writes results/benchmark.md (gas, batch savings, latency, accuracy)
```

| # | Scenario | Expected | Automated test |
|---|---|---|---|
| 1 | Valid credential | Verified | ✔ |
| 2 | Modified certificate (1-character edit) | Hash mismatch | ✔ |
| 3 | Unknown credential ID | Not found | ✔ |
| 4 | Revoked credential | Revoked | ✔ |
| 5 | Credential from an untrusted issuer | Verification failed | ✔ |
| 6 | Duplicate credential ID | Rejected (API 409 + contract revert) | ✔ |
| 7 | Non-admin issuance | Access denied (401/403) | ✔ |
| 8 | Blockchain unreachable | Unavailable (503, never a false pass) | ✔ |
| 9 | Non-PDF / empty upload | File rejected (415) | ✔ |
| 10 | Correction: old revoked, new issued | New credential valid | ✔ |
