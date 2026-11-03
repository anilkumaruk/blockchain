# Security Design — Chain of Record

This document lists the threats the system is designed against and the
control that addresses each one. Every control listed here is covered by an
automated test in `backend/test/` (`npm test`, and `npm run test:db` for the
PostgreSQL-specific ones).

## What lives where

| Data | Location | Exposure |
|---|---|---|
| docHash (SHA-256 of the certificate document), issuer address, timestamps, status | `CredentialRegistry` on Ethereum Sepolia (public) | Anyone can read; reveals no personal data |
| Merkle root per batch | Ethereum (public) | Reveals nothing about individual credentials |
| `keccak256(revocation reason)` | Ethereum (public) | Proves the reason later without publishing it |
| Marks card document | IPFS via Pinata, encrypted with AES-256-GCM | Unreadable without the key |
| The document's key | The student's QR link (after `#`, never sent to a server) and PostgreSQL | Student and server only |
| Student name, ID, course, dates, reason text, Merkle proofs | PostgreSQL (Supabase, Row Level Security on) | Server only |
| Password hashes, lockout state | PostgreSQL `users` | Server only, scrypt-hashed |
| Who did what, from which IP | PostgreSQL `audit_log` | Admins only, append-only |
| University and platform private keys | Each user's own MetaMask | **The server holds no private key** |

## Threats and controls

| # | Threat | Control | Where |
|---|---|---|---|
| 1 | Forged or edited certificate | The docHash covers every printed field and every semester row; any change gives a different hash, which the contract does not hold → INVALID | `CredentialRegistry.sol`, `photoVerify.js`, `hash.js` |
| 2 | Credential from a fake "university" | Only addresses the platform authorised with `setIssuer` can write; verification also checks the issuer is still active | contract `onlyIssuer`, `getCredential` / `verifyBatchCredential` |
| 3 | Insider edits the database | Every verification cross-checks the DB record against the on-chain hash → `record_mismatch` | `app.js` |
| 4 | Revocation erased to hide history | Revocation is a state change; issue and revoke events stay on-chain forever (`/history`) | contract, `chain.js` |
| 5 | Unauthorized issuance via API | JWT + role check on every write route; the server records an issue only after reading it back from the contract (this ID, this hash, signed by this institution's address, a successful transaction to this contract) | `auth.js`, `app.js` |
| 6 | Unauthorized issuance directly on-chain | `onlyIssuer` modifier; only the original issuer can revoke | contract |
| 7 | Password database leak | scrypt (N=16384, r=8, p=1) with a unique 16-byte salt per password | `passwords.js` |
| 8 | Password brute force | 5 failures → account locked 15 min (stored in DB); login rate limit 20 per 15 min per IP | `auth.js`, `app.js` |
| 9 | Username enumeration | Identical error for unknown user / wrong password; scrypt always runs (constant time) | `auth.js` |
| 10 | Token forgery / `alg=none` | HS256 pinned; issuer and audience checked; 1 h expiry; unique `jti` | `auth.js` |
| 11 | Weak production config | Server refuses to start without a ≥32-char JWT secret, a database and a CORS allowlist; warns if an old key variable is still set | `config.js` |
| 12 | Server compromise leaks signing keys | The server holds none: every issue, revoke, `setIssuer` and pause is signed in the user's MetaMask | `src/lib/wallet.js` |
| 13 | Issuer key compromise | Owner can `pause()` the registry (issue/revoke blocked, verify still works) and deactivate the issuer | contract, `/api/admin/pause` |
| 14 | Contract ownership hijack / typo | OpenZeppelin `Ownable2Step`: new owner must accept the transfer | contract |
| 15 | Batch proof forgery | OpenZeppelin `MerkleProof`; leaves double-hashed against second-preimage attacks | contract `leafOf()` |
| 16 | Injection / oversized input | Parameterized SQL only; field length, format and date validation; body size limits (10 KB–5 MB) | `store.js`, `app.js` |
| 17 | Certificate photos leaking | OCR runs in the browser; only the text read from the photo is sent | `src/lib/photoEvidence.js` |
| 18 | Clickjacking, MIME sniffing, downgrade | `helmet`: CSP, HSTS, X-Frame-Options, nosniff; `X-Powered-By` removed | `app.js` |
| 19 | Cross-site API use | CORS restricted to `CORS_ORIGIN` allowlist | `app.js`, `config.js` |
| 20 | Verification spam / scraping | Rate limits: verify 120/min, writes 60/min per IP | `app.js` |
| 21 | Audit tampering | `audit_log` has a trigger rejecting UPDATE and DELETE | `migrations/001_init.sql` |
| 22 | Blockchain outage gives false "valid" | Fail-safe: RPC errors and timeouts return 503 `unavailable`, never a verdict | `chain.js`, `app.js` |
| 23 | Partial batch written to DB | Batch rows inserted in a single transaction | `store.js` `insertMany()` |
| 24 | Fake college issuing credentials | Self-registered institutions stay *pending*; only the platform admin's approval authorizes their wallet on-chain | `institutions.js` |
| 25 | One institution revoking another's credential | API checks the issuing institution; the contract enforces `NotOriginalIssuer` | `app.js`, contract |
| 26 | Document on IPFS read by anyone | Encrypted with AES-256-GCM before pinning; the key travels only in the QR link's `#` part, which browsers never send to a server | `ipfs.js`, `chainVerify.js` |
| 27 | Student claiming someone else's credentials | Sign-up only for an email the institution has on record; one email per student | `app.js` `/api/auth/register/student` |
| 28 | Suspended institution keeps issuing with an old token | Institution status is re-checked on every issue/revoke, not only at sign-in | `institutions.js` `forUser()` |

## Known limitations (future work)

- **Student emails are not verified by a link.** Sign-up trusts that the institution entered the
  right email; adding an email verification step needs an email (SMTP) service.
- **One contract owner key.** The platform admin's MetaMask key controls `setIssuer` and `pause`. A hardware
  wallet or a multisig (e.g. Safe) as owner would remove that single point of failure.
- **The test dataset's university keys are on one machine.** `npm run import:karnataka` generates them into
  `TEST_WALLETS.json` (git-ignored) so the demo can sign; real universities would each create their own.
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
