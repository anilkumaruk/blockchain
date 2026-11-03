// A validator node: keeps its own full copy of the chain and its own state,
// and never trusts another node. A block is only accepted after this node has
// re-checked everything itself.

import { checkBlockContents } from './block.js';
import { ZERO_HASH, addressOf, canonicalJson, recoverSigner, sha256, signDigest } from './primitives.js';
import { ChainRuleError, LedgerState } from './state.js';
import { checkTransaction, transactionId } from './transaction.js';

// A strict majority: with 3 nodes, 2 votes commit a block and 1 node may be down.
export const quorumOf = (validatorCount) => Math.floor(validatorCount / 2) + 1;

/** Votes: enough distinct registered validators must have signed the block hash. */
export function checkVotes(block, validators) {
  const allowed = new Set(validators.map((v) => v.toLowerCase()));
  const voted = new Set();
  for (const signature of block.signatures) {
    const signer = recoverSigner(block.hash, signature)?.toLowerCase();
    if (signer && allowed.has(signer)) voted.add(signer);
  }
  return voted.size >= quorumOf(validators.length) ? null : 'not_enough_validator_signatures';
}

/** Every check that links this block to the chain before it, for one block. */
function checkLink(block, previous, expectedIndex) {
  if (block.header.index !== expectedIndex) return 'wrong_index';
  if (block.header.previousHash !== (previous?.hash ?? ZERO_HASH)) return 'previous_hash_mismatch';
  if (previous && block.header.timestamp < previous.header.timestamp) return 'timestamp_before_previous_block';
  return null;
}

/**
 * Replays a chain from block 0 with fresh state.
 * deep=true also verifies every ECDSA signature and validator vote (slower).
 * `verified` (optional Set) remembers blocks whose signatures already passed, by
 * a hash of the whole block, so identical copies are not checked twice.
 * Returns the state rebuilt from the valid prefix and the first problem found.
 */
export function replayChain(blocks, { deep = true, verified } = {}) {
  const state = new LedgerState();
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const fail = (problem) => ({ valid: false, validHeight: i - 1, invalidAt: i, problem, state });
    const problem = checkLink(block, blocks[i - 1], i) ?? checkBlockContents(block);
    if (problem) return fail(problem);
    // Always: stored data must still produce its id (the id feeds the Merkle root).
    if (block.transactions.some((tx) => transactionId(tx) !== tx.id)) return fail('transaction_data_altered');
    const fingerprint = deep && verified ? sha256(canonicalJson(block)) : null;
    const checkSignatures = deep && !verified?.has(fingerprint);
    if (checkSignatures) {
      for (const tx of block.transactions) {
        const txProblem = checkTransaction(tx);
        if (txProblem) return fail(`transaction_invalid: ${txProblem}`);
      }
    }
    try {
      for (const tx of block.transactions) state.apply(tx, i);
    } catch (err) {
      if (err instanceof ChainRuleError) return fail(`rule_violated: ${err.reason}`);
      throw err;
    }
    if (checkSignatures) {
      const votes = checkVotes(block, state.config.validators);
      if (votes) return fail(votes);
      verified?.add(fingerprint);
    }
  }
  return { valid: true, validHeight: blocks.length - 1, invalidAt: null, problem: null, state };
}

export class ChainNode {
  constructor(id, privateKey) {
    this.id = id;
    this.privateKey = privateKey;
    this.address = addressOf(privateKey);
    this.online = true;
    this.blocks = [];
    this.state = new LedgerState();
    this.integrity = { valid: true, validHeight: -1, invalidAt: null, problem: null };
  }

  get head() {
    return this.blocks.at(-1) ?? null;
  }

  get height() {
    return this.blocks.length - 1;
  }

  /** Replace this node's copy (start-up, or repair from the majority). */
  load(blocks, options) {
    const result = replayChain(blocks, options);
    this.blocks = blocks;
    this.state = result.state;
    this.integrity = {
      valid: result.valid,
      validHeight: result.validHeight,
      invalidAt: result.invalidAt,
      problem: result.problem,
    };
    return this.integrity;
  }

  /** Dry-runs transactions against current state; throws ChainRuleError if any breaks a rule. */
  checkTransactions(transactions, blockIndex) {
    const undo = [];
    try {
      for (const tx of transactions) {
        const problem = checkTransaction(tx);
        if (problem) throw new ChainRuleError(`InvalidTransaction: ${problem}`);
        undo.push(this.state.apply(tx, blockIndex));
      }
    } finally {
      undo.reverse().forEach((fn) => fn());
    }
  }

  /** A proposed block: re-check everything, then sign its hash as this node's vote. */
  vote(block) {
    const problem = checkLink(block, this.head, this.blocks.length) ?? checkBlockContents(block);
    if (problem) return { approved: false, nodeId: this.id, reason: problem };
    try {
      this.checkTransactions(block.transactions, block.header.index);
    } catch (err) {
      if (err instanceof ChainRuleError) return { approved: false, nodeId: this.id, reason: err.reason };
      throw err;
    }
    return { approved: true, nodeId: this.id, signature: signDigest(block.hash, this.privateKey) };
  }

  /** Commit a block that reached quorum. */
  commit(block) {
    for (const tx of block.transactions) this.state.apply(tx, block.header.index);
    this.blocks.push(block);
    this.integrity.validHeight = this.height;
  }
}
