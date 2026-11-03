// Prints, in the console, how the blockchain works. Runs entirely in memory.
//   npm run chain:demo

import { BlockchainNetwork, createTransaction, merkleProof, replayChain, sha256, verifyMerkleProof, addressOf } from '../blockchain/index.js';
import { deriveValidatorKeys } from '../server/ledger.js';

const say = (t = '') => console.log(t);
const short = (h) => `${h.slice(0, 16)}...`;
const key = (name) => `0x${sha256(`demo-${name}`)}`;
const authority = key('authority');
const vtu = key('vtu');

const net = new BlockchainNetwork(deriveValidatorKeys('demo'));
const add = (txs) => {
  const proposal = net.propose(txs);
  net.commit(proposal);
  const b = proposal.block;
  say(`Block ${b.header.index}  proposer ${b.header.proposer}  nonce ${b.header.nonce}  votes ${b.signatures.length}/3  txs ${b.transactions.length} (${b.transactions[0].type})`);
  say(`  previousHash ${short(b.header.previousHash)}`);
  say(`  merkleRoot   ${short(b.header.merkleRoot)}`);
  say(`  hash         ${short(b.hash)}`);
  return b;
};
const certHash = (s) => sha256(s);

say('=== 1. Building a chain: every block stores the hash of the one before ===');
add([net.genesisTransaction({ authorityKey: authority, authorityName: 'Platform', chainName: 'Demo', difficulty: 3 })]);
add([createTransaction('SET_ISSUER', { address: addressOf(vtu), name: 'VTU', active: true }, authority)]);
const txs = ['A', 'B', 'C', 'D'].map((n) =>
  createTransaction('ISSUE', { credentialId: `VTU-${n}`, certNo: `VTU/DC/2024/00000${n}`, certHash: certHash(`certificate ${n}`) }, vtu)
);
const certBlock = add(txs);
add([createTransaction('REVOKE', { credentialId: 'VTU-B', reasonHash: certHash('malpractice') }, vtu)]);
say();

say('=== 2. Merkle proof: one certificate proven with only 2 hashes, not the whole block ===');
const ids = txs.map((t) => t.id);
const proof = merkleProof(ids, 2);
say(`  proof valid: ${verifyMerkleProof(ids[2], proof, certBlock.header.merkleRoot)}`);
say(`  proof for a different transaction: ${verifyMerkleProof(ids[3], proof, certBlock.header.merkleRoot)}`);
say();

say('=== 3. Rules: the chain refuses what breaks them ===');
for (const [label, tx] of [
  ['duplicate certificate', createTransaction('ISSUE', { credentialId: 'VTU-A', certHash: certHash('x') }, vtu)],
  ['issuer not authorised', createTransaction('ISSUE', { credentialId: 'FAKE-1', certHash: certHash('y') }, key('fake'))],
  ['revoking twice', createTransaction('REVOKE', { credentialId: 'VTU-B' }, vtu)],
]) {
  try {
    net.propose([tx]);
    say(`  ${label}: ACCEPTED (unexpected)`);
  } catch (err) {
    say(`  ${label}: rejected (${err.reason})`);
  }
}
say();

say('=== 4. Tampering: edit a certificate hash in node-2 copy of block 2 ===');
net.nodes[1].blocks[2].transactions[0].payload.certHash = 'f'.repeat(64);
net.audit({ deep: true }).forEach((n) => say(`  ${n.node}: ${n.valid ? 'VALID' : `INVALID at block ${n.invalidAt} (${n.problem})`}`));
net.nodes[1].load(net.nodes[1].blocks, { deep: true });
say();

say('=== 5. Repair: the corrupted node copies from the healthy majority, then re-validates ===');
say(`  repaired: ${net.repair().join(', ')}`);
net.audit({ deep: true }).forEach((n) => say(`  ${n.node}: ${n.valid ? 'VALID' : 'INVALID'} height ${n.height} head ${short(n.head)}`));
say();

say('=== 6. One node offline: 2 of 3 votes is still a quorum; with two offline, nothing is added ===');
net.nodes[2].online = false;
add([createTransaction('ISSUE', { credentialId: 'VTU-E', certHash: certHash('certificate E') }, vtu)]);
net.nodes[1].online = false;
try {
  net.propose([createTransaction('ISSUE', { credentialId: 'VTU-F', certHash: certHash('F') }, vtu)]);
} catch (err) {
  say(`  two nodes offline: ${err.message}`);
}
net.nodes[1].online = true;
net.nodes[2].online = true;
say(`  node-3 back online and catching up: ${net.repair().join(', ')}`);
say();

say(`Final chain: ${net.leader.blocks.length} blocks, ${net.state.txCount} transactions, replay valid: ${replayChain(net.leader.blocks).valid}`);
