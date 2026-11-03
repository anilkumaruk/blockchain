// A block = header + transactions + validator signatures.
//
// The header is what gets hashed. It contains:
//   previousHash  the hash of the block before it  -> this is the "chain"
//   merkleRoot    a single hash covering every transaction in this block
//   nonce         the number found by proof-of-work
// So: edit a transaction -> merkleRoot changes -> block hash changes ->
// the next block's previousHash no longer matches -> every later block breaks.

import { merkleRoot } from './merkle.js';
import { canonicalJson, sha256 } from './primitives.js';

export const hashHeader = (header) => sha256(canonicalJson(header));

export const meetsDifficulty = (hash, difficulty) => hash.startsWith('0'.repeat(difficulty));

/** Proof of work: try nonces until the header hash starts with `difficulty` zeros. */
export function mine(header) {
  const candidate = { ...header, nonce: 0 };
  for (;;) {
    const hash = hashHeader(candidate);
    if (meetsDifficulty(hash, candidate.difficulty)) return { header: candidate, hash };
    candidate.nonce += 1;
  }
}

export function createBlock({ index, previousHash, transactions, difficulty, proposer, timestamp = Date.now() }) {
  const { header, hash } = mine({
    index,
    previousHash,
    merkleRoot: merkleRoot(transactions.map((t) => t.id)),
    timestamp,
    txCount: transactions.length,
    difficulty,
    proposer,
  });
  return { header, hash, transactions, signatures: [] };
}

/** Checks a block needs nothing else for: returns a problem name, or null. */
export function checkBlockContents(block) {
  if (merkleRoot(block.transactions.map((t) => t.id)) !== block.header.merkleRoot) return 'merkle_root_mismatch';
  if (hashHeader(block.header) !== block.hash) return 'block_hash_mismatch';
  if (!meetsDifficulty(block.hash, block.header.difficulty)) return 'proof_of_work_invalid';
  return null;
}
