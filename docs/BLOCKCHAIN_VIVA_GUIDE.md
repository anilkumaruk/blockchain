# Chain of Record: how the blockchain works (viva guide)

Every answer below points to code you can open and a screen you can show.
Show it live: **Blockchain** page (`/chain`), **Employer / Verifier → Certificate Photo** (`/verify`), and in a terminal `cd backend && npm run chain:demo`.

## 1. What the project does

Input: a photo of a certificate. Output: **VALID**, **INVALID** or **REVOKED**.

```
Photo → read QR + text (OCR) → find the certificate number on the blockchain
      → issuer authorised? → printed details match the university's record?
      → record hashes to the value on the chain? → marks hash to the value on the chain?
      → every node asked, majority must agree → walk the links from that block to the head
      → status on the chain
```

Code: `backend/server/photoVerify.js`, `src/lib/photoEvidence.js`.

**Why not hash the photo?** Two photos of one certificate have different pixels, so their hashes never match. So we hash the certificate's *data* (the canonical string), not the file:

`cert_no|reg_no|NAME|dob|program_code|score|year|univ_id` → SHA-256

The semester table has its own `marksHash` on the `ISSUE` transaction, so changing one SGPA on the marks card is caught too. If a table is present, every row must be read; a row that cannot be read gives INVALID ("could not read"), never VALID.

## 2. "How are blocks implemented?"

We wrote the blockchain ourselves in `backend/blockchain/` (about 560 lines). It does not run on Ethereum or any other chain.

A block (`block.js`) has:

| Field | Purpose |
|---|---|
| `index` | Position in the chain |
| `previousHash` | Hash of the previous block: **this is the chain** |
| `merkleRoot` | One hash covering all the block's transactions |
| `timestamp` | When it was created |
| `txCount` | Number of transactions (at most 25) |
| `difficulty`, `nonce` | Proof of work |
| `proposer` | The node that built it |

`hash = SHA-256(header)`. Transactions and validator signatures sit beside the header.

A transaction (`transaction.js`) is one signed statement: `GENESIS`, `SET_ISSUER`, `ISSUE`, `REVOKE` or `SET_PAUSED`. Each has an id (SHA-256 of its contents) and an ECDSA secp256k1 signature by its sender.

No names or personal data go on the chain: only certificate numbers, hashes and addresses.

## 3. "How do blocks operate with each other?"

Each block stores the previous block's hash. So:

```
Edit a transaction → its id no longer matches
Recompute the id   → the sender's signature fails, and the Merkle root changes
Update the root    → the header changes, so the block hash changes
Re-mine the block  → the next block's previousHash no longer matches
Re-mine every later block → validators never signed those hashes
```

**Show it:** Blockchain page → *Run the attack*. It performs these four steps on a throwaway copy and shows what the real validation code reports at each one.

## 4. "How many blocks are implemented?"

After importing the Karnataka dataset (open `/chain` for the live count, which grows with every issue or revoke):

| Blocks | Contents |
|---|---|
| 0 | Genesis: chain settings, validators, authority |
| 1–16 | Authorising 16 universities (`SET_ISSUER`) |
| 17–88 | 1,604 certificates (`ISSUE`, up to 25 per block) |
| 89–105 | 86 revocations (`REVOKE`) |
| **106 blocks** | **1,707 transactions** |

Each of the 3 nodes holds its own copy, so the database has 3 × 106 rows.

## 5. Other fundamentals

**Genesis block.** Block 0, with `previousHash` all zeros. It sets the authority address, the validators and the difficulty.

**Merkle tree** (`merkle.js`). Transaction ids are hashed in pairs up to one root. A proof needs about log2(n) hashes, so one certificate can be checked without the rest of the block. The verifier's result shows this proof.

**Proof of work** (`block.js`, `mine`). Try nonces until the hash starts with 3 zeros, about 4,096 attempts on average. This difficulty is low on purpose: it demonstrates the idea and makes rewriting history cost work, but real protection here comes from signatures and consensus.

**Consensus** (`network.js`). Proof of Authority, 3 validators:
1. The proposer for block n is node `n mod 3`.
2. It checks the transactions and mines the block.
3. Every node independently re-checks the block, then signs its hash as a vote.
4. With a majority (2 of 3) the block is committed.

One node cannot add a block alone. One node may be offline; with two offline, nothing is added.

**World state** (`state.js`). Who is authorised and each certificate's status are not stored separately: they are derived by replaying all transactions from block 0. The chain is the single source of truth.

**Rules** (`state.js`). Duplicate ID or hash, unauthorised issuer, revoking twice, and revoking another university's certificate are all rejected.

**Revocation.** A new `REVOKE` transaction. Nothing is deleted, so issue → revoke history stays visible.

**Tamper recovery.** `audit()` re-validates each node's copy from block 0. A corrupted node is excluded and repaired from the healthy nodes (`repair()`, `npm run chain:repair`).

**Verifying across many blocks.** A verification does not trust one row in one block. `crossCheck` (`backend/server/ledger.js`) asks all 3 nodes, only healthy nodes vote, and at least 2 must give the same answer. `walkFrom` then follows the links from the certificate's block to the latest block, re-checking each hash link and the validator signatures. The verifier's Proof section shows "nodes agree" and "links checked". Example: a certificate in block 17 of a 106-block chain checks 89 links.

**Where is it stored?** Each node's blocks are rows in the `chain_blocks` table in PostgreSQL. The student's detailed academic record stays off-chain in normal tables.

## 6. Measured results

| Test | Result | Command |
|---|---|---|
| Automated tests | 94 passing, 6 skipped without a database | `npm test` |
| Labelled verification requests | 666/666 | `npm run chain:evaluate` |
| Simulated marks-card photos (OCR + QR) | 120/126 overall | `npm run chain:photos` |
| Forged or fake photos correctly rejected | 90/90 | same run |
| Genuine or revoked photos correctly read | 30/36 (clean 11/12, phone-like 11/12, poor 8/12) | same run |

Details: `backend/results/verification-evaluation.md`, `backend/results/photo-ocr.md`.

Say this about the numbers if asked:
- The 666 cases use the claimed details as clean text, so they test the verifier and chain, **not** OCR.
- The 126 photos are rendered and degraded by software, **not taken by a camera**, and the matching rules were tuned on this kind of image. Real-world accuracy has not been measured and will be lower.
- All 6 errors are a real certificate rejected because a semester row could not be read. We chose that side on purpose: a clear re-take fixes a false rejection, but a forgery accepted as valid would defeat the system. 90 forgeries in a sample does not prove none can ever pass.
- Only this system's own card layout can be read. A certificate printed by a real university will not parse.

## 7. Known limits: say these before they are asked

1. **Not truly decentralised.** The 3 nodes run in one server process with keys derived from one secret and copies in one database. It demonstrates the protocol. Whoever controls that server could rewrite all three copies; real deployment needs nodes run by different universities on separate machines.
2. **With 3 validators, consensus tolerates a crash, not a malicious node majority.** Tolerating one actively malicious node in classical BFT needs at least 4 nodes.
3. **Blocks are created on request.** There is no shared mempool or peer-to-peer gossip.
4. **OCR tolerance.** Names allow small differences for OCR errors (90% similarity), and register numbers allow one character. So a one-letter name change on a long name may pass. Numbers (CGPA, year, date of birth) must match exactly.
5. **Proves the document, not the person.** An exact copy of someone's genuine certificate returns VALID.
6. **Revocation reasons are off-chain.** Only a hash of the reason is on-chain, so the readable text comes from the database.
7. **Hybrid, not a full DApp.** Users go through our Express server, and users do not hold wallets. The only parts that do not depend on our server are the public anchor and its check in the browser.

## 8. Decentralisation and smart contracts

| Layer | What runs it | Trust |
|---|---|---|
| Own chain (records every certificate) | Our 3 validator nodes | Demonstrates the protocol; one operator today |
| `CredentialRegistry.sol` on Sepolia (`anchorBatch`) | Public Ethereum test network | Independent of our server |
| Rules for issuing and revoking | `backend/blockchain/state.js` on our chain | Same rules every node replays |

**Is there a smart contract?** Yes, one: `backend/contracts/CredentialRegistry.sol`, deployed on Sepolia at `0xA34BE0F943de87b2414da6Ea44A49c2bb8d5B37a`. Each new head of our chain is sent to it (`backend/server/anchor.js`, `npm run chain:checkpoint`). Certificate rules on our own chain are ordinary JavaScript run by every node, which do the job a contract would.

**What does the anchor prove?** If someone rewrites all three copies of our chain, the head no longer matches what is on Sepolia. The browser reads Sepolia directly (`src/lib/publicAnchor.js`), so this check does not rely on our server. It detects a rewrite made after an anchor; it cannot stop one, and anything since the last anchor is uncovered.

## 9. Likely questions

**Why build your own chain instead of Ethereum?** To implement and show the fundamentals, with no gas fees and full control of block contents. The trade-off is limit 1 above: a public chain is far harder to rewrite.

**What if someone edits the database?** The record no longer hashes to the on-chain value → INVALID. Editing a stored block → that node fails validation.

**Why SHA-256?** Any change gives a completely different hash, and it is infeasible to find two inputs with the same hash.

**Why are signatures needed if we have hashes?** Hashes detect change; signatures prove who made the statement. Anyone can compute a hash, only the key holder can sign.

**What does the nonce do?** It is the only header field free to change, so miners vary it until the hash meets the difficulty.

**Could a student fake a QR code?** The QR holds a hash that must equal the on-chain one, and the printed details are still compared.

**Where does OCR run?** In the browser (Tesseract). The photo is never uploaded; only the text read from it is sent.
