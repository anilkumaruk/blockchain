// Checks the Sepolia wallet before deploying: address, balance, current gas
// price, and an estimate of what the full deployment + Karnataka import costs.
// Never prints the private key.
//
//   node scripts/sepolia-preflight.js

import 'dotenv/config';
import fs from 'node:fs';
import { JsonRpcProvider, Wallet, formatEther, parseUnits } from 'ethers';

const { SEPOLIA_RPC_URL, DEPLOYER_PRIVATE_KEY } = process.env;
if (!SEPOLIA_RPC_URL || !DEPLOYER_PRIVATE_KEY) {
  console.error('Set SEPOLIA_RPC_URL and DEPLOYER_PRIVATE_KEY in backend/.env first.');
  process.exit(1);
}
const provider = new JsonRpcProvider(SEPOLIA_RPC_URL);
const network = await provider.getNetwork();
if (network.chainId !== 11155111n) {
  console.error(`SEPOLIA_RPC_URL points at chain ${network.chainId}, not Sepolia (11155111).`);
  process.exit(1);
}
const wallet = new Wallet(DEPLOYER_PRIVATE_KEY, provider);
const balance = await provider.getBalance(wallet.address);
const fee = await provider.getFeeData();
const gasPrice = fee.maxFeePerGas ?? fee.gasPrice;

// Gas from the local rehearsal (results/benchmark.md and the import log).
const certs = JSON.parse(fs.readFileSync(new URL('../data/karnataka/degree_certificates.json', import.meta.url)));
const revocationsByUniv = {};
for (const c of certs) {
  if (['REVOKED', 'WITHHELD', 'CANCELLED_DUPLICATE_ISSUED'].includes(c.certificate_status)) {
    revocationsByUniv[c.univ_id] = (revocationsByUniv[c.univ_id] ?? 0) + 1;
  }
}
const maxRevocations = Math.max(...Object.values(revocationsByUniv));
const ownerGas = 1_700_000n + 16n * 80_000n + 150_000n + 70_000n * BigInt(revocationsByUniv.U02 ?? 0);
// Each university wallet pays for its own batch and revocations; 3x margin for fee spikes.
const perInstitutionGas = 150_000n + 70_000n * BigInt(maxRevocations);
const fundingWei = perInstitutionGas * gasPrice * 3n;
const needed = ownerGas * gasPrice * 2n + fundingWei * 16n;

console.log(`Wallet:        ${wallet.address}`);
console.log(`Balance:       ${formatEther(balance)} SepoliaETH`);
console.log(`Gas price:     ${Number(gasPrice) / 1e9} gwei`);
console.log(`Per-university funding: ${formatEther(fundingWei)} ETH (covers its batch + up to ${maxRevocations} revocations, 3x margin)`);
console.log(`Estimated total needed: ${formatEther(needed)} SepoliaETH`);
const floor = parseUnits('0.001', 'ether');
const recommended = fundingWei > floor ? fundingWei : floor;
console.log(`\nINSTITUTION_FUNDING_ETH=${formatEther(recommended)}`);
if (balance < needed) {
  console.log(`\nNOT ENOUGH: top up at least ${formatEther(needed - balance)} SepoliaETH (e.g. https://cloud.google.com/application/web3/faucet/ethereum/sepolia).`);
  process.exit(2);
}
console.log('\nOK: the wallet can pay for the deployment.');
