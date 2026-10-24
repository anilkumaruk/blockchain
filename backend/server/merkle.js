// Merkle tree compatible with OpenZeppelin's MerkleProof (sorted-pair
// keccak256). Used for batch issuance: one root on-chain covers many
// credentials; each credential keeps its own proof off-chain.

import { AbiCoder, concat, keccak256, toUtf8Bytes } from 'ethers';

const coder = AbiCoder.defaultAbiCoder();

/** Must match CredentialRegistry.leafOf(credentialId, docHash). */
export function leafOf(credentialId, docHash) {
  const inner = keccak256(coder.encode(['bytes32', 'bytes32'], [keccak256(toUtf8Bytes(credentialId)), docHash]));
  return keccak256(inner);
}

function hashPair(a, b) {
  return BigInt(a) < BigInt(b) ? keccak256(concat([a, b])) : keccak256(concat([b, a]));
}

/**
 * @param {string[]} leaves 0x-prefixed 32-byte hex leaves
 * @returns {{ root: string, proof: (index: number) => string[] }}
 */
export function buildMerkleTree(leaves) {
  if (leaves.length === 0) throw new Error('Cannot build a Merkle tree with no leaves');
  const layers = [leaves.map((l) => l.toLowerCase())];
  while (layers.at(-1).length > 1) {
    const prev = layers.at(-1);
    const next = [];
    for (let i = 0; i < prev.length; i += 2) {
      // An odd node out is promoted unchanged to the next level.
      next.push(i + 1 < prev.length ? hashPair(prev[i], prev[i + 1]) : prev[i]);
    }
    layers.push(next);
  }

  return {
    root: layers.at(-1)[0],
    proof(index) {
      const path = [];
      for (const layer of layers.slice(0, -1)) {
        const sibling = index ^ 1;
        if (sibling < layer.length) path.push(layer[sibling]);
        index >>= 1;
      }
      return path;
    },
  };
}
