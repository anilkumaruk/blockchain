// Consensus between the validator nodes: Proof of Authority with Proof of Work.
//   1. The proposer for block n is node[n mod N] (round-robin), skipping offline nodes.
//   2. It mines the block and signs it.
//   3. Every other online node independently re-checks it and votes.
//   4. With a majority of signatures (2 of 3) the block is committed on the nodes that voted.
// So one node, even the proposer, cannot add a block alone, and with 3 nodes
// the chain keeps working when one is offline or corrupted.
//
// The nodes run in one process and pass messages by function call; each keeps
// its own independent copy of the chain.

import { createBlock } from './block.js';
import { ZERO_HASH, addressOf } from './primitives.js';
import { ChainNode, quorumOf, replayChain } from './node.js';
import { ChainRuleError } from './state.js';
import { createTransaction } from './transaction.js';

export const MAX_TX_PER_BLOCK = 25;

export class QuorumError extends Error {
  constructor(votes) {
    super('Block rejected: not enough validators approved it.');
    this.name = 'QuorumError';
    this.votes = votes;
  }
}

export class BlockchainNetwork {
  /** @param {string[]} validatorKeys one private key per node */
  constructor(validatorKeys) {
    this.nodes = validatorKeys.map((key, i) => new ChainNode(`node-${i + 1}`, key));
    this.quorum = quorumOf(this.nodes.length);
  }

  get healthyNodes() {
    return this.nodes.filter((n) => n.online && n.integrity.valid);
  }

  /** A node that is online, uncorrupted, and on the longest healthy chain. */
  get leader() {
    return this.healthyNodes.reduce((best, n) => (!best || n.height > best.height ? n : best), null);
  }

  get state() {
    return this.leader?.state ?? null;
  }

  genesisTransaction({ authorityKey, authorityName, chainName, difficulty }) {
    return createTransaction(
      'GENESIS',
      {
        chainName,
        authority: addressOf(authorityKey),
        authorityName,
        validators: this.nodes.map((n) => n.address),
        difficulty,
      },
      authorityKey
    );
  }

  /** Runs the 4 consensus steps above. Returns the agreed block, not yet committed. */
  propose(transactions) {
    const leader = this.leader;
    if (!leader) throw new QuorumError([]);
    const index = leader.blocks.length;
    const ready = this.nodes.filter((n) => n.online && n.integrity.valid && n.height === leader.height);
    const proposer = ready[index % ready.length];
    proposer.checkTransactions(transactions, index); // a rule violation throws here

    const difficulty = leader.state.config?.difficulty ?? transactions[0].payload.difficulty;
    const block = createBlock({
      index,
      previousHash: leader.head?.hash ?? ZERO_HASH,
      transactions,
      difficulty,
      proposer: proposer.id,
    });
    const votes = ready.map((n) => n.vote(block));
    const approvals = votes.filter((v) => v.approved);
    if (approvals.length < this.quorum) throw new QuorumError(votes);
    block.signatures = approvals.map((v) => v.signature);
    return { block, voters: ready.filter((n) => votes.find((v) => v.nodeId === n.id)?.approved) };
  }

  commit({ block, voters }) {
    voters.forEach((n) => n.commit(structuredClone(block))); // every node keeps its own copy
  }

  /** Are all copies identical? A head hash held by a majority is the agreed chain. */
  consensus() {
    const counts = new Map();
    for (const n of this.nodes) {
      const hash = n.head?.hash ?? ZERO_HASH;
      counts.set(hash, (counts.get(hash) ?? 0) + 1);
    }
    const [majorityHead, votes] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    return { agreed: counts.size === 1, majorityHead, votes, quorumReached: votes >= this.quorum };
  }

  /** Repairs corrupted or behind nodes by copying from a healthy node, then re-validates. */
  repair() {
    const repaired = [];
    const leader = this.leader;
    if (!leader) return repaired;
    for (const n of this.nodes) {
      if (n === leader || !n.online) continue;
      const same = n.height === leader.height && n.head?.hash === leader.head?.hash;
      if (same && n.integrity.valid) continue;
      n.load(structuredClone(leader.blocks));
      repaired.push(n.id);
    }
    return repaired;
  }

  /** Full, independent audit of each node's copy, including every signature. */
  audit({ deep = true } = {}) {
    return this.nodes.map((n) => {
      const { valid, validHeight, invalidAt, problem } = replayChain(n.blocks, { deep });
      return { node: n.id, address: n.address, height: n.height, head: n.head?.hash ?? null, valid, validHeight, invalidAt, problem };
    });
  }
}

export { ChainRuleError };
