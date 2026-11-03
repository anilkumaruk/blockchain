// Reads the chain's anchored block hash directly from the Solidity contract on
// Ethereum Sepolia, from this browser, without going through our server. If the
// server's chain were rewritten, it would no longer match what is anchored here.

export const ANCHOR_CONTRACT = '0xA34BE0F943de87b2414da6Ea44A49c2bb8d5B37a';
export const ANCHOR_URL = `https://sepolia.etherscan.io/address/${ANCHOR_CONTRACT}`;
const RPC_URL = 'https://ethereum-sepolia-rpc.publicnode.com';
const ABI = [
  'function batchCount() view returns (uint256)',
  'function batches(uint256) view returns (bytes32 root, address issuer, uint64 anchoredAt, uint32 count)',
];

/**
 * @param {(index: number) => Promise<{hash: string}>} getBlock reads a block from our server
 * @returns {{ status: 'match'|'mismatch'|'none'|'unreachable', blockIndex?, hash?, anchoredAt? }}
 */
export async function checkPublicAnchor(getBlock) {
  let latest;
  try {
    const { Contract, JsonRpcProvider } = await import('ethers');
    const contract = new Contract(ANCHOR_CONTRACT, ABI, new JsonRpcProvider(RPC_URL, 11155111, { staticNetwork: true }));
    const n = await contract.batchCount();
    if (n === 0n) return { status: 'none' };
    latest = await contract.batches(n);
  } catch {
    return { status: 'unreachable' };
  }
  const blockIndex = Number(latest.count) - 1;
  const hash = latest.root.slice(2);
  const anchoredAt = new Date(Number(latest.anchoredAt) * 1000).toISOString();
  let block;
  try {
    block = await getBlock(blockIndex);
  } catch (err) {
    if (err.status === 404) return { status: 'mismatch', blockIndex, hash, anchoredAt };
    return { status: 'unreachable' };
  }
  return { status: block.hash === hash ? 'match' : 'mismatch', blockIndex, hash, anchoredAt };
}
