// Integrity under concurrency, forged storage and partial failures.

import { expect } from 'chai';
import { merkleRoot, mine, sha256, transactionId } from '../blockchain/index.js';
import { createLedger, createMemoryLedgerStore, deriveValidatorKeys } from '../server/ledger.js';

const AUTHORITY = `0x${sha256('integrity-authority')}`;
const hash = (s) => sha256(s);
const options = (ledgerStore, seed = 'i') => ({
  ledgerStore,
  authorityKey: AUTHORITY,
  validatorKeys: deriveValidatorKeys(seed),
  chainName: 'T',
  rootIssuerName: 'U',
  difficulty: 2,
});

describe('Integrity', () => {
  it('keeps one valid chain when two issues arrive at the same moment', async () => {
    const ledgerStore = createMemoryLedgerStore();
    const ledger = createLedger(options(ledgerStore));
    const bridge = ledger.bridge(AUTHORITY);
    await bridge.issue('C-0', hash('c0'));
    const receipts = await Promise.all([bridge.issue('C-1', hash('c1')), bridge.issue('C-2', hash('c2'))]);
    expect(receipts[0].blockNumber).to.not.equal(receipts[1].blockNumber);

    const restarted = createLedger(options(ledgerStore));
    (await restarted.explorer.audit({ deep: true })).forEach((n) => expect(n, n.node).to.include({ valid: true, height: 3 }));
    expect((await restarted.bridge(AUTHORITY).getById('C-2')).certHash).to.equal(hash('c2'));
  });

  it('rejects a forgery written consistently into every stored copy', async () => {
    const ledgerStore = createMemoryLedgerStore();
    await createLedger(options(ledgerStore, 'f')).bridge(AUTHORITY).issue('F-1', hash('genuine'));
    // An attacker with database access rewrites block 1 in all three copies:
    // new data, recomputed id, Merkle root and proof of work. Signatures cannot be redone.
    for (const node of ['node-1', 'node-2', 'node-3']) {
      ledgerStore.corrupt(node, 1, (b) => {
        const tx = b.transactions[0];
        tx.payload.certHash = hash('forged');
        tx.id = transactionId(tx);
        const mined = mine({ ...b.header, merkleRoot: merkleRoot(b.transactions.map((t) => t.id)) });
        b.header = mined.header;
        b.hash = mined.hash;
      });
    }
    const restarted = createLedger(options(ledgerStore, 'f')).bridge(AUTHORITY);
    let answer = null;
    let error = null;
    await restarted.getById('F-1').then((a) => (answer = a), (e) => (error = e));
    expect(answer?.certHash, 'the forged hash must never be returned').to.not.equal(hash('forged'));
    expect(error?.name).to.equal('ChainUnavailableError');
  });
});
