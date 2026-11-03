# Chain of Record — Blockchain-Based Verifiable Academic Credential System

E1CSA313 Design Project-1, Alliance University  
Team: Manu M P, Tarun Kumar S, Anilkumar U K, Pruthviraj D N · Mentor: Dr. Saravanan P

A blockchain-backed verification layer on top of a university's academic records.
At issuance, the SHA-256 fingerprints of each certificate and its marks are recorded on
the project's own blockchain, whose latest block is anchored to a Solidity contract on
Sepolia. Anyone can then verify a marks card from a photo, QR code or credential ID.

- Website: https://blockchain-ecru-three.vercel.app

## What it does

**Input: a photo of a certificate. Output: VALID, INVALID or REVOKED.**

The blockchain is the project's own, written from scratch in `backend/blockchain/`: blocks with SHA-256 hash links, Merkle trees, ECDSA-signed transactions, proof of work and majority voting among 3 validator nodes. Each verification asks all 3 nodes, needs a majority, and walks the links from the certificate's block to the latest block.

- Explain it: [docs/BLOCKCHAIN_VIVA_GUIDE.md](docs/BLOCKCHAIN_VIVA_GUIDE.md)
- See it: the **Blockchain** page (`/chain`), or `cd backend && npm run chain:demo`
- Measure it: `npm test`, `npm run chain:evaluate`, `npm run chain:photos`

Rebuild the data: `npm run db:reset -- --confirm && npm run import:karnataka`, then send the latest block to Sepolia with `npm run chain:checkpoint`. No blockchain node needs running; the chain is stored in PostgreSQL.

The sections below describe the rest of the system. Where they mention per-credential Solidity transactions, gas or Hardhat nodes, that is the earlier version. Today the contract is used only to anchor the chain head.

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

- **Platform admin** (`platform.admin`) belongs to no university. It approves or suspends
  institutions and runs the registry controls (pause, audit log), but cannot see, issue or revoke
  any university's credentials.
- **Universities** (Alliance University included) each have registrar accounts that issue, revoke
  and view only their own credentials, signed on-chain with their own issuer wallet.
- **Institutions** register at `/register/institution` and stay *pending* until the admin approves them.
  Approval creates the institution's own issuer wallet (encrypted with `WALLET_ENCRYPTION_KEY`),
  authorizes it on-chain with `setIssuer`, and funds it for gas. Its credentials are then recorded
  on-chain under its own address. Suspending it makes them fail verification (`untrusted_issuer`).
- **Students** sign in at `/student` with their personal email. They can create an account only for an
  email their institution has on record (entered as "Student personal email" when issuing), and see
  only their own credentials.

## Dataset: Karnataka Degree Registry

`backend/data/karnataka` holds the dataset (16 universities, 2,000 students, 1,604 degree certificates,
666 labelled verification requests). `npm run import:karnataka` loads it and records every certificate
on the chain. Test logins are written to `backend/data/karnataka/TEST_LOGINS.md`, which is not committed.

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
src/                    Website (React): pages/, components/, lib/
  pages/VerificationUI.jsx      Verify a certificate photo, QR or ID
  pages/ChainExplorer.jsx       Blockchain page: blocks, nodes, tamper demo
  lib/certificateSvg.js         Student marks card design
  lib/photoEvidence.js          Reads the photo in the browser (QR + OCR)
public/                 Sample certificate photos and the OCR engine files
api/index.js            Vercel entry point for the backend
backend/
  blockchain/           The project's own blockchain (blocks, Merkle, signatures, consensus)
  server/               Express API: app.js, ledger.js, photoVerify.js, anchor.js, store.js, auth.js
  server/migrations/    Database schema (SQL)
  contracts/            Solidity contract on Sepolia (anchors the chain head)
  data/karnataka/       The dataset
  scripts/              Import, reset, chain demo/repair/checkpoint, evaluation
  test/                 Automated tests
  results/              Measured results (verification, photo OCR)
docs/BLOCKCHAIN_VIVA_GUIDE.md   How the blockchain works, for the viva
archive/                Old and unused files, kept for reference only
```

Folders created by tools, not edited by hand: `node_modules/`, `dist/`, `backend/artifacts/`, `backend/cache/`.

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
npm run import:karnataka  # loads the dataset onto the chain

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
npm run chain:evaluate  # 666 labelled verification requests
npm run chain:photos    # simulated certificate photos (OCR + QR)
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
