// Deploys CredentialRegistry and writes deployments/<network>.json, which
// the API server reads to find the contract address and ABI.

import fs from 'node:fs';
import path from 'node:path';
import hre from 'hardhat';

const institution = process.env.INSTITUTION_NAME || 'Alliance University';

const [deployer] = await hre.ethers.getSigners();
console.log(`Deploying CredentialRegistry to "${hre.network.name}" from ${deployer.address}...`);

const registry = await hre.ethers.deployContract('CredentialRegistry', [institution]);
await registry.waitForDeployment();
const address = await registry.getAddress();
const receipt = await registry.deploymentTransaction().wait();

const artifact = await hre.artifacts.readArtifact('CredentialRegistry');
const outDir = path.join(hre.config.paths.root, 'deployments');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(
  path.join(outDir, `${hre.network.name}.json`),
  JSON.stringify(
    {
      network: hre.network.name,
      chainId: Number((await hre.ethers.provider.getNetwork()).chainId),
      address,
      owner: deployer.address,
      institution,
      deployTx: receipt.hash,
      blockNumber: receipt.blockNumber,
      abi: artifact.abi,
    },
    null,
    2
  )
);

console.log(`CredentialRegistry deployed at ${address} (block ${receipt.blockNumber}, gas ${receipt.gasUsed})`);
