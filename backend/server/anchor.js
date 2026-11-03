// Public anchor: writes our chain's latest block hash into the Solidity
// CredentialRegistry on Ethereum Sepolia (anchorBatch). Once anchored, even
// someone who controls this server and database cannot rewrite those blocks
// unnoticed, because the browser reads the anchored hash directly from Sepolia.
// Best effort: a failed anchor never blocks issuing; the next one covers it.

import { Contract, JsonRpcProvider, Wallet } from 'ethers';

const WAIT_MS = 8000;

/** @param {{ rpcUrl: string, privateKey: string, deployment: { address: string, abi: object[], chainId: number } }} options */
export function createPublicAnchor({ rpcUrl, privateKey, deployment }) {
  const provider = new JsonRpcProvider(rpcUrl, deployment.chainId, { staticNetwork: true, cacheTimeout: -1 });
  const contract = new Contract(deployment.address, deployment.abi, new Wallet(privateKey, provider));

  /** Sends the transaction; `wait` also waits for it to be mined (for scripts). */
  async function anchor(headHash, blockCount, { wait = false } = {}) {
    const tx = await contract.anchorBatch(`0x${headHash}`, blockCount);
    if (wait) await tx.wait();
    return tx.hash;
  }

  async function bestEffort(block) {
    let timer;
    try {
      await Promise.race([
        anchor(block.hash, block.header.index + 1),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('timed out')), WAIT_MS);
        }),
      ]);
    } catch (err) {
      console.warn(`[anchor] block ${block.header.index} not anchored: ${err.shortMessage ?? err.message}`);
    } finally {
      clearTimeout(timer);
    }
  }

  return { anchor, bestEffort, address: deployment.address };
}
