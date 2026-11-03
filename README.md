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
- Measure it: `cd backend && npm test`, `npm run chain:evaluate`, `npm run chain:photos`
- Every file and workflow: [docs/Project_File_Guide.pdf](docs/Project_File_Guide.pdf)

## Architecture

```
React (Vite) ──REST──▶ Node.js + Express ──▶ own blockchain (backend/blockchain)
 Verify (photo/QR/ID)   JWT + roles, helmet,    3 validator nodes, majority 2 of 3,
 Credential Center      rate limits, audit log  each node's copy stored in PostgreSQL
 Student Portal                     │                     │ newest block hash
 Blockchain page                    ▼                     ▼
                        PostgreSQL (records,     CredentialRegistry.sol on Sepolia
                        users, audit log)        anchorBatch(head hash)
```

No blockchain node or wallet has to run: the chain lives in the database. With
`CHAIN_NETWORK=sepolia` each new block's hash is also anchored on Ethereum Sepolia,
and the Blockchain page reads that anchor directly from Sepolia.

## Blockchain features

| Feature | What it does | Code |
|---|---|---|
| Hash-linked blocks | Each block stores the previous block's SHA-256 hash, a Merkle root of its transactions and a proof-of-work nonce | `blockchain/block.js`, `merkle.js` |
| Signed transactions | `GENESIS`, `SET_ISSUER`, `ISSUE`, `REVOKE`, `SET_PAUSED`, each signed with ECDSA secp256k1 by its sender | `blockchain/transaction.js` |
| Consensus | Proof of authority: 3 validators re-check every block and sign it; 2 of 3 signatures commit it | `blockchain/network.js`, `node.js` |
| Rules | Only authorised universities issue; only the issuer revokes; no duplicate ID or hash; pause stops writes | `blockchain/state.js` |
| Verified storage | Every signature is re-checked when blocks are loaded from the database; a corrupted copy loses its vote and can be repaired | `server/ledger.js` |
| Majority reads | Each verification asks all 3 nodes and needs 2 matching answers, then walks the links to the newest block | `server/ledger.js` |
| Revocation | A new `REVOKE` transaction; the issue record is never deleted | `blockchain/state.js` |
| Public anchor | The newest block hash is written to `CredentialRegistry.anchorBatch` on Sepolia | `server/anchor.js` |

The Solidity contract also contains the earlier per-credential and Merkle-batch
functions, emergency pause and two-step ownership; they stay fully tested
(`test/CredentialRegistry.test.js`, `batch.test.js`, `contract-reverts.test.js`)
but the running system uses only `anchorBatch`.

See [SECURITY.md](SECURITY.md) for the threat model and all security controls.

## Accounts: institutions and students

- **Platform admin** (`platform.admin`, the first account the server creates) belongs to no
  university. It approves or suspends institutions and runs the registry controls (pause, audit
  log), but cannot see, issue or revoke any university's credentials.
- **Universities** (Alliance University included) each have registrar accounts that issue, revoke
  and view only their own credentials, signed on-chain with their own issuer wallet.
- **Institutions** register at `/register/institution` and stay *pending* until the admin approves them.
  Approval creates the institution's own signing key (encrypted with `WALLET_ENCRYPTION_KEY`) and
  authorises it on the chain with a `SET_ISSUER` transaction. Its credentials are then recorded
  under its own address. Suspending it makes them fail verification (`untrusted_issuer`).
- **Students** sign in at `/student` with their personal email. They can create an account only for an
  email their institution has on record (entered as "Student personal email" when issuing), and see
  only their own credentials.

## Dataset: Karnataka Degree Registry

`backend/data/karnataka` holds the dataset (17 universities, 2,000 students, 1,604 degree certificates,
666 labelled verification requests). `npm run import:karnataka` loads it and records every certificate
on the chain. Test logins are written to `backend/data/karnataka/TEST_LOGINS.md`, which is not committed.

| Data | Where | Why |
|---|---|---|
| Certificate number, SHA-256 of the certificate data, of the certificate file and of the semester marks, issuer address, status | On-chain | Tamper-evident; no personal data |
| Student name, ID, marks, dates, revocation reason text | Off-chain (PostgreSQL) | Privacy; only `keccak256(reason)` goes on-chain |
| Certificate PDF and marks card | Generated deterministically from the record | Re-hashing must reproduce the on-chain hash |

The **chain is the source of truth** for hash and status. The off-chain record is
cross-checked against it on every verification, so tampering with the database
is detected too (`record_mismatch`, `hash_mismatch`, `marks_hash_mismatch`).

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

cp .env.example .env      # then set ADMIN_PASSWORD and JWT_SECRET

# 2. PostgreSQL in Docker
npm run db:up

# 3. Start the API (terminal 1): runs migrations, creates block 0 and the
#    platform admin, http://localhost:4000
npm start

# 4. Load the dataset onto the chain (terminal 2); writes the test logins to
#    data/karnataka/TEST_LOGINS.md (not committed)
npm run import:karnataka

# 5. Website against the real backend (terminal 3, repo root)
npm install
VITE_API_URL=http://localhost:4000 npm run dev
```

No Hardhat node and no contract deployment are needed. Sign in to the Credential
Center as a university admin from `TEST_LOGINS.md` to issue and revoke; the
`platform.admin` account (password `ADMIN_PASSWORD`) approves universities but cannot issue.
More accounts: `npm run create-user -- <username> <admin|student> [studentId]`
(prompts for the password, stores an scrypt hash).
Without `VITE_API_URL` the website runs an in-browser mock whose results are
simulated (the banner says so); a Vercel production build refuses to run without it.

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

**Sepolia anchor:** the contract is already deployed (`backend/deployments/sepolia.json`).
Start the API with `CHAIN_NETWORK=sepolia`, `SEPOLIA_RPC_URL` and `ISSUER_PRIVATE_KEY`
(a fresh wallet funded only with Sepolia test ETH) and each new block's hash is anchored;
`npm run chain:checkpoint` anchors the current head on demand. Never commit `.env`.
To deploy a new contract: set `DEPLOYER_PRIVATE_KEY` and run `npm run deploy:sepolia`.

**Production** (`NODE_ENV=production`): the server refuses to start without a
database, a ≥32-character `JWT_SECRET`, a `CORS_ORIGIN` allowlist and a real issuer key.

## REST API

| Method | Path | Role | Purpose |
|---|---|---|---|
| POST | `/api/auth/login` | – | Email or username; returns a JWT (`admin`, `institution` or `student`) |
| POST | `/api/auth/register/student` | – | Student account for an email an institution has on record |
| POST | `/api/institutions/register` | – | Institution application (pending until approved) |
| GET | `/api/institutions` | – | Public directory of approved issuers |
| GET | `/api/me` | signed in | Own profile |
| GET | `/api/me/certificates`, `/api/me/credentials` | student | Own certificates, with marks card data |
| GET | `/api/admin/institutions` | platform admin | All institutions |
| POST | `/api/admin/institutions/:id/approve` · `reject` · `suspend` | platform admin | Institution lifecycle (approve creates and authorises its signing key) |
| POST | `/api/credentials` | university | Hash the certificate, record it on the chain under the university's key, store the record (optional `studentEmail`) |
| POST | `/api/credentials/batch` | university | Up to 500 credentials, 25 transactions per block |
| GET | `/api/credentials` | university | Own university's records |
| GET | `/api/credentials/:id/certificate` | university | Marks card data for an own certificate |
| POST | `/api/credentials/:id/revoke` | university (issuer only) | `REVOKE` transaction (no deletion) |
| POST | `/api/credentials/:id/reissue` | university (issuer only) | Revoke + issue corrected credential, linked both ways |
| GET | `/api/credentials/:id`, `/api/credentials/:id/history` | – | Public record and issue/revoke trail |
| GET | `/api/admin/audit` | platform admin | Audit log (logins, failed logins, issue, revoke, pause) |
| GET | `/api/admin/registry` | platform admin | Chain id, authority, platform issuer, paused state |
| POST | `/api/admin/pause` | platform admin | Emergency stop / resume (`{ "paused": true }`) |
| GET | `/api/students/:studentId/credentials` | – | Shared student profile |
| POST | `/api/verify/photo` | – | Text and QR read from a certificate photo → valid / invalid / revoked |
| GET | `/api/verify/:credentialId` | – | Verify by ID, certificate number or QR |
| POST | `/api/verify/hash`, `/api/verify/file` | – | Verify a SHA-256, or an uploaded PDF (server recomputes the hash) |
| GET | `/api/chain/summary`, `/api/chain/blocks`, `/api/chain/blocks/:index` | – | Blockchain explorer |
| GET | `/api/chain/audit` | – | Re-validate every node from block 0 |
| POST | `/api/chain/simulate-tamper` | – | Tamper demonstration on a throwaway copy |
| GET | `/api/health` | – | Chain + store status |

Verification by ID, hash or file returns `status` (`valid` / `revoked` / `invalid`) and a
`code` (`not_found`, `hash_mismatch`, `untrusted_issuer`, `record_mismatch`). Photo
verification returns `verdict` and a `code` listed in `docs/BLOCKCHAIN_VIVA_GUIDE.md`.
When the chain has no majority answer, or the database does not answer, the API returns
an error (503 / 500), never a verdict.

## Testing and evaluation

```bash
cd backend
npm test                # 117 tests: own chain, integrity, contract, security, scenarios
npm run test:db         # + 7 PostgreSQL integration tests (needs npm run db:up)
npm run coverage        # Solidity coverage
npm run coverage:js     # server and chain coverage
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
