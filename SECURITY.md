# Security Design — Chain of Record

This document lists the threats the system is designed against and the
control that addresses each one. Every control listed here is covered by an
automated test in `backend/test/` (`npm test`, and `npm run test:db` for the
PostgreSQL-specific ones).

## What lives where

| Data | Location | Exposure |
|---|---|---|
| SHA-256 of certificate, issuer address, timestamps, status | Blockchain (public) | Anyone can read; reveals no personal data |
| Merkle root per batch | Blockchain (public) | Reveals nothing about individual credentials |
| `keccak256(revocation reason)` | Blockchain (public) | Proves the reason later without publishing it |
| Student name, ID, course, dates, reason text, Merkle proofs | PostgreSQL | Server only |
| Password hashes, lockout state | PostgreSQL `users` | Server only, scrypt-hashed |
| Who did what, from which IP | PostgreSQL `audit_log` | Admins only, append-only |
| Issuer private key | Server environment (`ISSUER_PRIVATE_KEY`) | Never logged, never in the repo |

## Threats and controls

| # | Threat | Control | Where |
|---|---|---|---|
| 1 | Forged or edited certificate | SHA-256 of the PDF is anchored on-chain; any 1-byte change fails verification | `CredentialRegistry.sol`, `app.js` |
| 2 | Credential from a fake "university" | Verification trusts only the configured issuer address; other issuers → `untrusted_issuer` | `app.js` `evaluate()` |
| 3 | Insider edits the database | Every verification cross-checks the DB record against the on-chain hash → `record_mismatch` | `app.js` |
| 4 | Revocation erased to hide history | Revocation is a state change; issue and revoke events stay on-chain forever (`/history`) | contract, `chain.js` |
| 5 | Unauthorized issuance via API | JWT + role check (`admin`) on every write route | `auth.js` |
| 6 | Unauthorized issuance directly on-chain | `onlyIssuer` modifier; only the original issuer can revoke | contract |
| 7 | Password database leak | scrypt (N=16384, r=8, p=1) with a unique 16-byte salt per password | `passwords.js` |
| 8 | Password brute force | 5 failures → account locked 15 min (stored in DB); login rate limit 20 per 15 min per IP | `auth.js`, `app.js` |
| 9 | Username enumeration | Identical error for unknown user / wrong password; scrypt always runs (constant time) | `auth.js` |
| 10 | Token forgery / `alg=none` | HS256 pinned; issuer and audience checked; 1 h expiry; unique `jti` | `auth.js` |
| 11 | Weak production config | Server refuses to start without a ≥32-char JWT secret, a database, a CORS allowlist and a non-dev issuer key | `config.js` |
| 12 | Hardhat dev key used on a real network | Rejected on any non-localhost network | `config.js` |
| 13 | Issuer key compromise | Owner can `pause()` the registry (issue/revoke blocked, verify still works) and deactivate the issuer | contract, `/api/admin/pause` |
| 14 | Contract ownership hijack / typo | OpenZeppelin `Ownable2Step`: new owner must accept the transfer | contract |
| 15 | Batch proof forgery | OpenZeppelin `MerkleProof`; leaves double-hashed against second-preimage attacks | contract `leafOf()` |
| 16 | Injection / oversized input | Parameterized SQL only; field length, format and date validation; body size limits (10 KB–5 MB) | `store.js`, `app.js` |
| 17 | Non-PDF uploads | Magic-byte check (`%PDF-`), 5 MB cap → 415/413 | `app.js` |
| 18 | Clickjacking, MIME sniffing, downgrade | `helmet`: CSP, HSTS, X-Frame-Options, nosniff; `X-Powered-By` removed | `app.js` |
| 19 | Cross-site API use | CORS restricted to `CORS_ORIGIN` allowlist | `app.js`, `config.js` |
| 20 | Verification spam / scraping | Rate limits: verify 120/min, writes 60/min per IP | `app.js` |
| 21 | Audit tampering | `audit_log` has a trigger rejecting UPDATE and DELETE | `migrations/001_init.sql` |
| 22 | Blockchain outage gives false "valid" | Fail-safe: RPC errors and timeouts return 503 `unavailable`, never a verdict | `chain.js`, `app.js` |
| 23 | Partial batch written to DB | Batch rows inserted in a single transaction | `store.js` `insertMany()` |
| 24 | Fake college issuing credentials | Self-registered institutions stay *pending*; only the platform admin's approval authorizes their wallet on-chain | `institutions.js` |
| 25 | One institution revoking another's credential | API checks the issuing institution; the contract enforces `NotOriginalIssuer` | `app.js`, contract |
| 26 | Institution wallet key theft from the database | Keys encrypted with AES-256-GCM under `WALLET_ENCRYPTION_KEY` (required in production, kept outside the DB) | `wallets.js`, `config.js` |
| 27 | Student claiming someone else's credentials | Sign-up only for an email the institution has on record; one email per student | `app.js` `/api/auth/register/student` |
| 28 | Suspended institution keeps issuing with an old token | Institution status is re-checked on every issue/revoke, not only at sign-in | `institutions.js` `forUser()` |

## Known limitations (future work)

- **Student emails are not verified by a link.** Sign-up trusts that the institution entered the
  right email; adding an email verification step needs an email (SMTP) service.
- **Institution wallets are custodial.** The server holds their (encrypted) keys; a production rollout
  would let each institution hold its own key (e.g. MetaMask) or use a KMS.
- **Single issuer key on the server.** A hardware wallet / KMS or a multisig
  (e.g. Safe) as contract owner would remove the single point of failure.
- **Chain and DB writes are not atomic.** If the DB insert fails after the
  transaction confirms, the credential is on-chain without an off-chain record.
  It cannot be faked by this. It shows up as "verified without details" and
  can be reconciled from the `CredentialIssued` events.
- **No token revocation list.** Logging out discards the token client-side;
  a stolen token stays valid until it expires (1 h).
- **Student portal data is public by student ID.** This suits shareable
  profiles; a production rollout should require the student's own JWT.
- **Rate-limit counters are per process.** Running several API instances
  needs a shared store (Redis) for the limiter.
- **The contract has no external audit.** It uses audited OpenZeppelin
  building blocks and has full test coverage of its functions. A third-party
  audit would be needed before mainnet use.
