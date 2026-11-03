# Chain of Record: how the blockchain works (viva guide)

Every answer below points to code you can open and a screen you can show.
Show it live: **Blockchain** page (`/chain`), **Employer / Verifier → Certificate Photo** (`/verify`),
and the contract on Etherscan: https://sepolia.etherscan.io/address/0x2E36EB891D77c7f9dE0BC1b00D17ECb00f37D15E

## 1. What the project does

Input: a photo of a certificate. Output: **VALID**, **INVALID** or **REVOKED**.

```
Photo → read QR + text in the browser (OCR) → certificate number
      → ask the smart contract: is this credential recorded? by an authorised issuer?
      → printed details match the university's record?
      → the record + every semester row hash (SHA-256) to the docHash in the contract?
      → QR hash equals that docHash?
      → revoked in the contract?
```

Code: `backend/server/photoVerify.js`, `src/lib/photoEvidence.js`, `backend/server/chain.js`.

**Why not hash the photo?** Two photos of one certificate have different pixels, so their hashes never
match. We hash the certificate's *data*:

`docHash = SHA-256( cert_no|reg_no|NAME|dob|program|score|year|univ  +  every semester row )`

Changing one SGPA changes the docHash, so the contract no longer holds it → INVALID. If a semester table
is present, every row must be read; a row that cannot be read gives INVALID ("could not read"), never VALID.

## 2. "Which blockchain is it?"

**Ethereum**, on its public test network **Sepolia** (chain id 11155111). It is a real blockchain: thousands
of independent nodes, Proof of Stake consensus, a new block every 12 seconds. Test ETH has no money value;
that is the only difference from Ethereum mainnet.

Our part of it is one **smart contract**, `backend/contracts/CredentialRegistry.sol`, deployed at
`0x2E36EB891D77c7f9dE0BC1b00D17ECb00f37D15E` in block 12,054,016.

| Function | Who may call it | What it does |
|---|---|---|
| `setIssuer(address, name, active)` | Contract owner (platform admin) | Authorise or suspend a university's wallet |
| `issueCredential(id, docHash)` | Authorised university | Record one certificate |
| `anchorBatch(root, count)` | Authorised university | Record many certificates under one Merkle root |
| `revokeCredential` / `revokeBatchCredential` | Only the university that issued it | Mark it revoked, with `keccak256(reason)` |
| `getCredential`, `verifyBatchCredential` | Anyone, free | Read status, issuer and whether the issuer is still active |
| `pause()` / `unpause()` | Owner | Emergency stop for issuing and revoking; verifying still works |

The contract refuses bad writes itself: `NotAuthorizedIssuer`, `CredentialAlreadyExists`,
`HashAlreadyRegistered`, `NotOriginalIssuer`, `AlreadyRevoked`, `RootAlreadyAnchored`, `InvalidProof`.

## 3. "How does a certificate get into a block?"

```
1. Registrar fills the form      → server builds the document and returns its docHash   (POST /api/credentials/prepare)
2. Registrar clicks Issue        → MetaMask opens: issueCredential(id, docHash)          (src/lib/wallet.js)
3. Registrar approves            → MetaMask signs with the university's private key and broadcasts
4. Ethereum validators           → put the transaction in a block; the block is chained by its parent hash
5. Website                       → POST /api/credentials with the transaction hash
6. Server reads the contract     → this ID, this docHash, from this university's address, a successful
                                   transaction to this contract → only then saves the record
7. Server encrypts the document  → AES-256-GCM, pins it to IPFS (Pinata); the key goes only into the QR
```

**The server never holds a private key.** If someone takes over the server, they still cannot issue.

## 4. "How do blocks operate with each other?"

Every Ethereum block header holds the **hash of its parent block**. So:

```
Change a transaction in an old block → that block's transactions root changes
→ its block hash changes → the next block's parentHash no longer matches
→ every later block would have to be rebuilt, and the validators would have to agree
```

**Show it:** Blockchain page → click a block number in "Latest contract events": it shows the block hash
and the parent block hash, read straight from Ethereum.

## 5. "Which blocks does a verification check?"

| Check | Read from | Fails as |
|---|---|---|
| Credential ID is recorded, with this docHash | Contract storage (`getCredential` / `verifyBatchCredential` + Merkle proof) | `not_on_chain`, `hash_mismatch` |
| The issuer address is authorised and still active | Contract `issuers` mapping | `untrusted_issuer` |
| The transaction that recorded it succeeded, was sent to our contract, by that issuer | The transaction receipt and **its block** (number, block hash) | not saved at all |
| How deep it is | Latest block number − its block number + 1 = **confirmations** | – |
| Revoked? | Contract status / `revokedAt` | `revoked` |

The verifier's **Proof** section shows network, contract, transaction, block number, block hash,
confirmations, batch ID, Merkle root and whether the Merkle proof is valid.

## 6. Merkle batches (how 1,604 certificates fit in 17 transactions)

Each university signs **one** `anchorBatch` covering all its certificates:

1. Leaf = `keccak256(keccak256(credentialId, docHash))` (double hash, as OpenZeppelin does, against second-preimage attacks).
2. Leaves are hashed in pairs up to one **root**. Only the root goes on-chain.
3. To check one certificate, give its leaf and about log2(n) sibling hashes (the **proof**, ~8 hashes for 150 certificates).
   The contract recomputes the root (`MerkleProof.verify`) and compares.

## 7. QR code: verification without our server

The QR link is `…/verify/<cert no>/<docHash>#cid=<IPFS address>&k=<key>`. The part after `#` is never sent to any server.
Scanning it in the website (`src/lib/chainVerify.js`):

1. Download the encrypted document from IPFS (any public gateway).
2. Decrypt it in the browser with the key from the QR.
3. Recompute its SHA-256; it must equal the hash in the QR.
4. Ask Ethereum directly (public RPC): is this hash recorded by an authorised university, and not revoked?
5. Read the transaction's block: block number and confirmations.

Our API server and database are not used at all.

## 8. Live numbers (Karnataka dataset on Sepolia)

| Item | Count |
|---|---|
| Universities authorised with `setIssuer` | 17 (+ the platform address, deactivated) |
| Degree certificates | 1,604, in **17 Merkle batches** (one per university) |
| Revocations | 86, each its own transaction signed by the issuing university |
| First batch | block 12,054,064 (VTU, 131 certificates) |

## 9. Measured results

| Test | Result | Command |
|---|---|---|
| Automated tests (contract, API on Hardhat's Ethereum, photo, IPFS, security) | 92 passing; 99 with the database tests | `npm test`, `npm run test:db` |
| Labelled verification requests | 666 / 666 | `npm run chain:evaluate` |
| Simulated marks-card photos (OCR + QR), 42 per level | clean 42/42, phone-like 42/42, poor 39/42 | `npm run chain:photos` |

Say this about the numbers if asked:
- The 666 cases use the claimed details as clean text, so they test the verifier and contract, **not** OCR.
- The photos are rendered and degraded by software, **not taken by a camera**. Real-world accuracy has not been measured.
- The 3 errors are on small, blurred photos. We chose to reject when unsure: a clear re-take fixes a false rejection,
  but a forgery accepted as valid would defeat the system.

## 10. Known limits: say these before they are asked

1. **Sepolia is a test network.** Same software and consensus as Ethereum mainnet; test ETH has no value.
2. **The server and database are still central** for personal data, photo checks and sign-in. The contract,
   IPFS and the QR check do not depend on them.
3. **Proves the document, not the person.** An exact copy of someone's genuine certificate returns VALID.
4. **Revocation reasons are off-chain.** Only `keccak256(reason)` is on-chain; the text is in the database.
5. **The student app is a PWA** (installable web app), not Flutter. Hyperledger is not used; the brief lists it as an option.
6. **OCR tolerance.** Names allow small OCR differences (90% similarity); numbers (CGPA, year, date of birth) must match exactly.

## 11. Likely questions

**Why Ethereum and not your own chain?** A public chain is run by thousands of nodes we do not control, so
nobody, including us, can rewrite a record. Our earlier own chain is kept in `archive/own-blockchain/`.

**What if someone edits the database?** The record no longer hashes to the docHash in the contract → INVALID.

**What if the server is hacked?** It holds no keys, so it cannot issue or revoke. The QR check still works without it.

**Why SHA-256 for the document and keccak256 in the contract?** SHA-256 is standard for documents and runs in every browser;
keccak256 is Ethereum's native hash, cheap inside the contract.

**Why are signatures needed if we have hashes?** Hashes detect change; signatures prove who made the statement.
MetaMask signs every transaction with the university's private key; the contract sees that address as `msg.sender`.

**Who pays gas?** The university's wallet, in Sepolia test ETH. One batch of ~150 certificates costs one transaction.

**Could a student fake a QR code?** The QR's hash must equal the one in the contract, and the printed details are still compared.

**Where does OCR run?** In the browser (Tesseract). The photo is never uploaded; only the text read from it is sent.
