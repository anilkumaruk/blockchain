// MetaMask: every write to the blockchain is signed here, in the user's own
// wallet. The Chain of Record server never holds a private key.
//
// Which contract: backend/deployments/<VITE_CHAIN_NETWORK>.json (default sepolia),
// written by `npm run deploy:sepolia` / `deploy:local`.

import { BrowserProvider, Contract, keccak256, toUtf8Bytes } from 'ethers';

const deployments = import.meta.glob('../../backend/deployments/*.json', { eager: true, import: 'default' });
const network = import.meta.env.VITE_CHAIN_NETWORK || 'sepolia';
const deployment = deployments[`../../backend/deployments/${network}.json`];

const NETWORKS = {
  sepolia: {
    chainId: '0xaa36a7',
    chainName: 'Sepolia',
    rpcUrls: ['https://ethereum-sepolia-rpc.publicnode.com'],
    nativeCurrency: { name: 'Sepolia ETH', symbol: 'ETH', decimals: 18 },
    blockExplorerUrls: ['https://sepolia.etherscan.io'],
  },
  localhost: {
    chainId: '0x7a69',
    chainName: 'Hardhat (localhost)',
    rpcUrls: ['http://127.0.0.1:8545'],
    nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
    blockExplorerUrls: null,
  },
};

/** The contract this website talks to. */
export const CHAIN = {
  network,
  chainId: deployment?.chainId ?? null,
  address: deployment?.address ?? null,
  abi: deployment?.abi ?? [],
  deploymentBlock: deployment?.blockNumber ?? 0,
  rpcUrl: NETWORKS[network]?.rpcUrls[0] ?? null,
  explorer: NETWORKS[network]?.blockExplorerUrls?.[0] ?? null,
};

export const txLink = (hash) => (CHAIN.explorer && hash ? `${CHAIN.explorer}/tx/${hash}` : null);
export const addressLink = (address) => (CHAIN.explorer && address ? `${CHAIN.explorer}/address/${address}` : null);

/** The revocation reason exactly as the server normalises and checks it. */
export const normalizeReason = (reason) => String(reason ?? '').trim().slice(0, 500) || 'No reason provided.';
export const reasonHash = (reason) => keccak256(toUtf8Bytes(normalizeReason(reason)));

const friendly = (err) => {
  if (err?.code === 4001 || err?.code === 'ACTION_REJECTED' || err?.info?.error?.code === 4001) {
    return new Error('You rejected the transaction in MetaMask. Nothing was recorded.');
  }
  const revert = err?.revert?.name ?? err?.reason;
  if (revert) return new Error(`The smart contract refused it: ${revert}.`);
  if (err?.code === 'INSUFFICIENT_FUNDS') return new Error('This MetaMask account has no test ETH to pay for gas.');
  return err instanceof Error ? err : new Error(String(err));
};

/** Connects MetaMask on the right network, as the expected account. */
async function connect(expectedAddress) {
  if (!deployment) throw new Error(`No contract is deployed for "${network}".`);
  if (typeof window === 'undefined' || !window.ethereum) {
    throw new Error('MetaMask is needed to sign this. Install it from metamask.io and reload the page.');
  }
  const provider = new BrowserProvider(window.ethereum);
  await provider.send('eth_requestAccounts', []);
  const wanted = NETWORKS[network];
  const current = await provider.send('eth_chainId', []);
  if (current !== wanted.chainId) {
    try {
      await provider.send('wallet_switchEthereumChain', [{ chainId: wanted.chainId }]);
    } catch (err) {
      if (err?.code !== 4902 && err?.error?.code !== 4902) throw friendly(err);
      await provider.send('wallet_addEthereumChain', [wanted]);
    }
  }
  const signer = await new BrowserProvider(window.ethereum).getSigner();
  if (expectedAddress && signer.address.toLowerCase() !== expectedAddress.toLowerCase()) {
    throw new Error(`Switch MetaMask to the account ${expectedAddress} (the one registered for this role), then try again.`);
  }
  return signer;
}

/** Signs one contract call in MetaMask and waits until it is mined. */
export async function sendTransaction(method, args, expectedAddress) {
  try {
    const signer = await connect(expectedAddress);
    const contract = new Contract(CHAIN.address, CHAIN.abi, signer);
    const tx = await contract[method](...args);
    const receipt = await tx.wait();
    return { receipt, contract };
  } catch (err) {
    throw friendly(err);
  }
}

export async function connectedAddress() {
  return (await connect()).address;
}
