# Chain of Record — Blockchain-Based Verifiable Academic Credential System

E1CSA313 Design Project-1, Alliance University  
Team: Manu M P, Tarun Kumar S, Anilkumar U K, Pruthviraj D N · Mentor: Dr. Saravanan P

A decentralised application (DApp) for issuing and verifying academic credentials, built to
the project brief (Ministry of Education / UGC problem statement): a smart contract on
Ethereum manages issuance and revocation, universities sign in MetaMask, encrypted documents
live on IPFS, and a QR code lets anyone verify a certificate.

- Website: https://blockchain-ecru-three.vercel.app
- Smart contract: `CredentialRegistry` on Ethereum Sepolia, `0x2E36EB891D77c7f9dE0BC1b00D17ECb00f37D15E`
- How it works, step by step: [docs/Blockchain_In_Our_Application.pdf](docs/Blockchain_In_Our_Application.pdf)

## What it does

**Input: a photo of a certificate. Output: VALID, INVALID or REVOKED.**

| Part of the brief | Where |
|---|---|
| Smart contracts manage credential issuance and revocation | `backend/contracts/CredentialRegistry.sol` on Ethereum Sepolia |
| Issuer dashboard for universities | Credential Center (`/admin`): issue one, issue a Merkle batch, revoke; every write signed in MetaMask |
| Student wallet / mobile app | Student Portal (`/student`), installable on a phone (PWA); holds each certificate's QR and key |
| Verifier portal for employers | `/verify`: certificate photo, QR scan, credential ID |
| IPFS stores encrypted documents | Each marks card is encrypted (AES-256-GCM) and pinned to IPFS through Pinata |
| QR verification without central servers | The QR link holds the IPFS address and key after `#`; the browser checks IPFS and Ethereum directly |
| Self-sovereign control | Only the student's QR carries the key; the student decides who can read the document |
| Integration with university systems via APIs | REST API below |

## How a certificate is recorded and checked

```
University (MetaMask) ──signs──▶ CredentialRegistry (Ethereum Sepolia) ◀──reads── Verifier
        │                          issueCredential / anchorBatch                  │
        │                          revokeCredential / setIssuer                   │
        ▼                                                                         │
  API server (no keys) ── prepares the docHash, confirms each write by reading ───┘
        │                 the contract, verifies photos
        ▼
  PostgreSQL (personal data)          IPFS (encrypted marks cards)
```

1. **Hash.** The server builds the certificate's document: its canonical line
   (`cert_no|reg_no|NAME|dob|program|score|year|univ`) plus every semester row. Its SHA-256 is the **docHash**.
2. **Sign.** The registrar signs `issueCredential(id, docHash)` in MetaMask, or `anchorBatch(root, count)`
   for a Merkle root covering many certificates.
3. **Mine.** Ethereum puts the transaction in a block; each block stores its parent block's hash.
4. **Confirm.** The server reads the contract back (this ID, this hash, signed by this university's
   address) before saving anything. It then encrypts the document and pins it to IPFS.
5. **Verify.** Anyone reads the contract: is this exact hash there, from an authorised issuer, and not revoked?

The server never holds a private key. The platform admin (contract owner) authorises
universities with `setIssuer`, also in MetaMask.

## Accounts

- **Platform admin** (`platform.admin`, the first account the server creates) signs as the contract
  owner: approves or suspends institutions (`setIssuer`) and pauses the registry. It cannot issue.
- **Universities** each have registrar accounts and a MetaMask address. They issue, revoke and view only
  their own credentials; the contract also refuses a revocation by anyone but the original issuer.
- **Institutions** register at `/register/institution` with their MetaMask address and stay *pending*
  until the platform admin authorises that address in the contract.
- **Students** sign in at `/student` with their personal email (only one their university has on record).

## Dataset: Karnataka Degree Registry

`backend/data/karnataka`: 17 universities, 2,000 students, 1,604 degree certificates, 666 labelled
verification requests (synthetic). `npm run import:karnataka` gives each university a test wallet,
authorises it, and has each university sign **one Merkle batch** for its certificates (17 batches);
86 certificates are then revoked by their own university. Test logins and the universities' MetaMask
test keys are written to `TEST_LOGINS.md` / `TEST_WALLETS.json` there (git-ignored).

| Data | Where |
|---|---|
| docHash (or Merkle root), issuer address, issued / revoked time, status | Smart contract on Ethereum |
| Names, marks, dates, revocation reason text, users, audit log | PostgreSQL (Supabase), Row Level Security on |
| The marks card document, encrypted | IPFS (Pinata) |
| The key to that document | Only in the student's QR code (and the database, so the student can download it again) |

## Running locally

```bash
cd backend && npm install --legacy-peer-deps
cp .env.example .env          # set ADMIN_PASSWORD and JWT_SECRET
npm run db:up                 # PostgreSQL in Docker
npm run chain                 # terminal 1: local Ethereum (Hardhat) on 127.0.0.1:8545
npm run deploy:local          # terminal 2: deploys CredentialRegistry
npm start                     # API on http://localhost:4000 (CHAIN_NETWORK=localhost)
npm run import:karnataka      # dataset into the contract and the database
cd .. && npm install
VITE_API_URL=http://localhost:4000 VITE_CHAIN_NETWORK=localhost npm run dev
```

In MetaMask, add the network `http://127.0.0.1:8545` (chain id 31337), import Hardhat account #0 for
the platform admin and a university key from `TEST_WALLETS.json` for a registrar.

**Sepolia (the live setup):** `npm run deploy:sepolia` (needs `DEPLOYER_PRIVATE_KEY` and
`SEPOLIA_RPC_URL` in `.env`, test ETH only), then start the API with `CHAIN_NETWORK=sepolia`. The
deployer key is used only by the deploy and import scripts on your machine, never by the server.
Set `PINATA_JWT` to store encrypted documents on IPFS.

**Supabase:** use the Session pooler connection string, save the CA certificate as
`backend/certs/prod-ca-2021.crt`, set `DATABASE_SSL_CA=certs/prod-ca-2021.crt`, run `npm run db:check`.

## REST API

| Method | Path | Who | Purpose |
|---|---|---|---|
| POST | `/api/auth/login` | – | Sign in; returns a JWT |
| POST | `/api/auth/register/student` | – | Student account for an email on record |
| POST | `/api/institutions/register` | – | Institution application with its MetaMask address |
| GET | `/api/institutions` | – | Approved institutions |
| POST | `/api/credentials/prepare` | university | The docHash to sign in MetaMask |
| POST | `/api/credentials` | university | Record an issue the contract confirms (ID, hash, issuer, transaction) |
| POST | `/api/credentials/batch/prepare` · `/api/credentials/batch` | university | Merkle root to sign; record the batch the contract confirms |
| POST | `/api/credentials/:id/revoke` | university (issuer) | Record a revocation the contract shows, with the same reason hash |
| GET | `/api/credentials`, `/api/credentials/:id/certificate` | university | Own records; marks card data |
| GET | `/api/me`, `/api/me/certificates` | signed in / student | Own profile; marks cards with QR data |
| POST | `/api/verify/photo` | – | Text and QR read from a certificate photo → valid / invalid / revoked |
| GET | `/api/verify/:id` · POST `/api/verify/hash` | – | Verify by ID, certificate number or docHash |
| GET | `/api/credentials/:id/history` | – | Issue / batch / revoke events from the contract |
| GET | `/api/admin/institutions` · POST `…/:id/approve`·`suspend`·`reject` | platform admin | Confirm a `setIssuer` signed in MetaMask |
| GET | `/api/admin/registry`, `/api/admin/audit` · POST `/api/admin/pause` | platform admin | Contract status, audit log, record a pause signed in MetaMask |
| GET | `/api/health` | – | Contract, database and IPFS status |

If Ethereum or the database does not answer, the API returns an error (503 / 500), never a verdict.

## Testing and evaluation

```bash
cd backend
npm test                # 92 tests: contract, API on Hardhat's Ethereum, photo, IPFS, security
npm run test:db         # + 7 PostgreSQL integration tests (needs npm run db:up)
npm run coverage        # Solidity coverage
npm run chain:evaluate  # 666 labelled verification requests against the contract
npm run chain:photos    # simulated certificate photos (OCR + QR) against the contract
```

| Measure | Result |
|---|---|
| Automated tests | 92 passing; 99 with the database tests |
| Labelled verification requests | 666 / 666 |
| Simulated photos (42 per quality level) | clean 42/42 · phone-like 42/42 · poor (small, blurred) 39/42 |

## Repository layout

```
src/                     Website: pages/, components/, lib/
  lib/wallet.js          MetaMask: every transaction is signed here
  lib/chainVerify.js     Browser-only check: IPFS + Ethereum, no server
  lib/certificateSvg.js  Marks card with QR
public/                  Sample photos, OCR engine, PWA manifest and service worker
api/index.js             Vercel entry point for the API
backend/
  contracts/             CredentialRegistry.sol (the smart contract)
  deployments/           Contract address and ABI per network
  server/                API: app.js, chain.js (contract reads), photoVerify.js, ipfs.js, hash.js
  scripts/               deploy, import, evaluation, sample photos, db tools
  test/                  Automated tests
docs/                    Guides and the blockchain PDF
archive/                 Retired files, including the team's earlier own blockchain
```

## Known limits

- The live network is **Sepolia**, Ethereum's public test network: real blocks and consensus, test ETH.
- The **server and database are central** parts: personal data, photo checks and confirmations run there.
  The contract, IPFS and the QR check do not depend on it.
- The **student app is a PWA**, not a Flutter app; Hyperledger is not used (the brief lists both as options).
- **OCR**: only this system's marks-card layout is read; photo accuracy was measured on simulated photos only.
- The dataset is **synthetic**; certificates say "Not an official university document".
