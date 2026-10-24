import { expect } from 'chai';
import hre from 'hardhat';
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';

const { ethers } = hre;
const HASH_A = '0x' + 'a1'.repeat(32);
const HASH_B = '0x' + 'b2'.repeat(32);
const reason = (s) => ethers.keccak256(ethers.toUtf8Bytes(s));

async function deployFixture() {
  const [owner, rogue, outsider] = await ethers.getSigners();
  const registry = await ethers.deployContract('CredentialRegistry', ['Alliance University']);
  return { registry, owner, rogue, outsider };
}

describe('CredentialRegistry (contract)', () => {
  it('registers the deployer as the first active issuer', async () => {
    const { registry, owner } = await loadFixture(deployFixture);
    expect(await registry.owner()).to.equal(owner.address);
    const issuer = await registry.issuers(owner.address);
    expect(issuer.active).to.equal(true);
    expect(issuer.name).to.equal('Alliance University');
  });

  it('issues a credential, storing only hash, issuer, timestamps and status', async () => {
    const { registry, owner } = await loadFixture(deployFixture);
    const key = ethers.keccak256(ethers.toUtf8Bytes('COR-2026-000001'));
    await expect(registry.issueCredential('COR-2026-000001', HASH_A))
      .to.emit(registry, 'CredentialIssued')
      .withArgs(key, 'COR-2026-000001', HASH_A, owner.address);

    const [c, issuerActive] = await registry.getCredential('COR-2026-000001');
    expect(c.docHash).to.equal(HASH_A);
    expect(c.issuer).to.equal(owner.address);
    expect(c.status).to.equal(1n);
    expect(c.revokedAt).to.equal(0n);
    expect(issuerActive).to.equal(true);
    expect(await registry.keyByHash(HASH_A)).to.equal(key);
    expect(await registry.totalIssued()).to.equal(1n);
  });

  it('verifyCredential reports an exact match and a mismatch', async () => {
    const { registry, owner } = await loadFixture(deployFixture);
    await registry.issueCredential('COR-1', HASH_A);
    const ok = await registry.verifyCredential('COR-1', HASH_A);
    expect([ok.exists, ok.hashMatches, ok.revoked, ok.issuerActive, ok.issuer]).to.deep.equal([
      true, true, false, true, owner.address,
    ]);
    const bad = await registry.verifyCredential('COR-1', HASH_B);
    expect(bad.exists).to.equal(true);
    expect(bad.hashMatches).to.equal(false);
    const missing = await registry.verifyCredential('NOPE', HASH_A);
    expect(missing.exists).to.equal(false);
  });

  it('rejects duplicate IDs, reused hashes and empty values', async () => {
    const { registry } = await loadFixture(deployFixture);
    await registry.issueCredential('COR-1', HASH_A);
    await expect(registry.issueCredential('COR-1', HASH_B)).to.be.revertedWithCustomError(
      registry, 'CredentialAlreadyExists'
    );
    await expect(registry.issueCredential('COR-2', HASH_A)).to.be.revertedWithCustomError(
      registry, 'HashAlreadyRegistered'
    );
    await expect(registry.issueCredential('', HASH_B)).to.be.revertedWithCustomError(registry, 'EmptyValue');
    await expect(registry.issueCredential('COR-3', ethers.ZeroHash)).to.be.revertedWithCustomError(
      registry, 'EmptyValue'
    );
  });

  it('blocks issuance and revocation by unauthorized accounts', async () => {
    const { registry, outsider } = await loadFixture(deployFixture);
    await expect(
      registry.connect(outsider).issueCredential('COR-X', HASH_A)
    ).to.be.revertedWithCustomError(registry, 'NotAuthorizedIssuer');
    await registry.issueCredential('COR-1', HASH_A);
    await expect(
      registry.connect(outsider).revokeCredential('COR-1', reason('x'))
    ).to.be.revertedWithCustomError(registry, 'NotAuthorizedIssuer');
    await expect(
      registry.connect(outsider).setIssuer(outsider.address, 'Fake', true)
    ).to.be.revertedWithCustomError(registry, 'OwnableUnauthorizedAccount');
  });

  it('revokes as a state change and keeps the record auditable', async () => {
    const { registry, owner } = await loadFixture(deployFixture);
    await registry.issueCredential('COR-1', HASH_A);
    const key = ethers.keccak256(ethers.toUtf8Bytes('COR-1'));
    await expect(registry.revokeCredential('COR-1', reason('Issued in error')))
      .to.emit(registry, 'CredentialRevoked')
      .withArgs(key, 'COR-1', reason('Issued in error'), owner.address);

    const [c] = await registry.getCredential('COR-1');
    expect(c.status).to.equal(2n);
    expect(c.docHash).to.equal(HASH_A); // history preserved, not deleted
    expect(c.revokedAt).to.be.greaterThan(0n);
    expect(await registry.totalRevoked()).to.equal(1n);

    await expect(registry.revokeCredential('COR-1', reason('again'))).to.be.revertedWithCustomError(
      registry, 'AlreadyRevoked'
    );
    await expect(registry.revokeCredential('NOPE', reason('x'))).to.be.revertedWithCustomError(
      registry, 'CredentialNotFound'
    );
  });

  it('only the original issuer can revoke a credential', async () => {
    const { registry, rogue } = await loadFixture(deployFixture);
    await registry.setIssuer(rogue.address, 'Other College', true);
    await registry.issueCredential('COR-1', HASH_A);
    await expect(
      registry.connect(rogue).revokeCredential('COR-1', reason('x'))
    ).to.be.revertedWithCustomError(registry, 'NotOriginalIssuer');
  });

  it('deactivating an issuer is reflected in verification results', async () => {
    const { registry, rogue } = await loadFixture(deployFixture);
    await registry.setIssuer(rogue.address, 'Other College', true);
    await registry.connect(rogue).issueCredential('OTH-1', HASH_A);
    await expect(registry.setIssuer(rogue.address, 'Other College', false))
      .to.emit(registry, 'IssuerUpdated')
      .withArgs(rogue.address, 'Other College', false);
    const [, issuerActive] = await registry.getCredentialByHash(HASH_A);
    expect(issuerActive).to.equal(false);
  });
});
