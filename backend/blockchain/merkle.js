// Merkle tree over a block's transaction ids.
//
//            root            <- stored in the block header
//           /    \
//        h(ab)   h(cd)
//        /  \    /  \
//       a    b  c    d       <- transaction ids
//
// Changing any transaction changes the root. A proof is the list of sibling
// hashes from a leaf to the root (log2(n) hashes), so one transaction can be
// checked without the rest of the block. An odd node is paired with itself.

import { ZERO_HASH, sha256 } from './primitives.js';

const parent = (left, right) => sha256(Buffer.from(left + right, 'hex'));

function levels(leaves) {
  const out = [leaves];
  while (out.at(-1).length > 1) {
    const level = out.at(-1);
    const next = [];
    for (let i = 0; i < level.length; i += 2) next.push(parent(level[i], level[i + 1] ?? level[i]));
    out.push(next);
  }
  return out;
}

export const merkleRoot = (leaves) => (leaves.length ? levels(leaves).at(-1)[0] : ZERO_HASH);

export function merkleProof(leaves, index) {
  const proof = [];
  let i = index;
  for (const level of levels(leaves).slice(0, -1)) {
    const isRight = i % 2 === 1;
    const sibling = isRight ? level[i - 1] : level[i + 1] ?? level[i];
    proof.push({ hash: sibling, position: isRight ? 'left' : 'right' });
    i = Math.floor(i / 2);
  }
  return proof;
}

export function verifyMerkleProof(leaf, proof, root) {
  let hash = leaf;
  for (const step of proof) hash = step.position === 'left' ? parent(step.hash, hash) : parent(hash, step.hash);
  return hash === root;
}
