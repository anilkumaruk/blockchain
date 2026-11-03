// Every revert path of CredentialRegistry that the other contract tests do not reach.

import { expect } from 'chai';
import hre from 'hardhat';
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';
import { buildMerkleTree, leafOf } from '../server/merkle.js';

const { ethers } = hre;
const reason = (s) => ethers.keccak256(ethers.toUtf8Bytes(s));
const hashOf = (i) => '0x' + i.toString(16).padStart(64, '0');

async function deployFixture() {
  const [owner, otherIssuer, outsider] = await ethers.getSigners();
  const registry = await ethers.deployContract('CredentialRegistry', ['Alliance University']);
  await registry.setIssuer(otherIssuer.address, 'Other University', true);
  await registry.issueCredential('COR-1', hashOf(1));
  const tree = buildMerkleTree([1, 2, 3].map((i) => leafOf(`B-${i}`, hashOf(100 + i))));
  await registry.anchorBatch(tree.root, 3);
  const member = { credentialId: 'B-1', hash: hashOf(101), proof: tree.proof(0) };
  return { registry, owner, otherIssuer, outsider, member };
}

describe('CredentialRegistry revert paths', () => {
  it('refuses the zero address as an issuer', async () => {
    const { registry } = await loadFixture(deployFixture);
    await expect(registry.setIssuer(ethers.ZeroAddress, 'Nobody', true)).to.be.revertedWithCustomError(registry, 'EmptyValue');
  });

  it('lets only the owner pause and unpause', async () => {
    const { registry, outsider } = await loadFixture(deployFixture);
    await expect(registry.connect(outsider).pause()).to.be.revertedWithCustomError(registry, 'OwnableUnauthorizedAccount');
    await registry.pause();
    await expect(registry.connect(outsider).unpause()).to.be.revertedWithCustomError(registry, 'OwnableUnauthorizedAccount');
    await expect(registry.unpause()).to.emit(registry, 'Unpaused');
  });

  it('blocks every write while paused', async () => {
    const { registry, member } = await loadFixture(deployFixture);
    await registry.pause();
    await expect(registry.issueCredential('COR-2', hashOf(2))).to.be.revertedWithCustomError(registry, 'EnforcedPause');
    await expect(registry.revokeCredential('COR-1', reason('x'))).to.be.revertedWithCustomError(registry, 'EnforcedPause');
    await expect(registry.anchorBatch(hashOf(9), 1)).to.be.revertedWithCustomError(registry, 'EnforcedPause');
    await expect(
      registry.revokeBatchCredential(1, member.credentialId, member.hash, member.proof, reason('x'))
    ).to.be.revertedWithCustomError(registry, 'EnforcedPause');
  });

  it('blocks revocation and batch revocation by an account that is not an issuer', async () => {
    const { registry, outsider, member } = await loadFixture(deployFixture);
    await expect(registry.connect(outsider).revokeCredential('COR-1', reason('x'))).to.be.revertedWithCustomError(
      registry,
      'NotAuthorizedIssuer'
    );
    await expect(
      registry.connect(outsider).revokeBatchCredential(1, member.credentialId, member.hash, member.proof, reason('x'))
    ).to.be.revertedWithCustomError(registry, 'NotAuthorizedIssuer');
  });

  it('rejects an unknown batch and a batch revocation by a different issuer', async () => {
    const { registry, otherIssuer, member } = await loadFixture(deployFixture);
    await expect(
      registry.revokeBatchCredential(99, member.credentialId, member.hash, member.proof, reason('x'))
    ).to.be.revertedWithCustomError(registry, 'BatchNotFound');
    await expect(
      registry.connect(otherIssuer).revokeBatchCredential(1, member.credentialId, member.hash, member.proof, reason('x'))
    ).to.be.revertedWithCustomError(registry, 'NotOriginalIssuer');
  });

  it('stops a deactivated issuer from writing', async () => {
    const { registry, otherIssuer } = await loadFixture(deployFixture);
    await registry.setIssuer(otherIssuer.address, 'Other University', false);
    await expect(registry.connect(otherIssuer).issueCredential('COR-9', hashOf(9))).to.be.revertedWithCustomError(
      registry,
      'NotAuthorizedIssuer'
    );
  });
});
