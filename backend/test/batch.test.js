// Merkle-tree batch issuance: one transaction anchors one root covering many
// credentials; each credential is verified with its own proof.

import { expect } from 'chai';
import hre from 'hardhat';
import request from 'supertest';
import { buildMerkleTree, leafOf } from '../server/merkle.js';
import { buildApp, login } from './helpers.js';
import { buildCertificateBytes } from '../../src/lib/generateCertificatePdf.js';

const { ethers } = hre;
const reason = (s) => ethers.keccak256(ethers.toUtf8Bytes(s));
const hashOf = (i) => '0x' + i.toString(16).padStart(64, '0');

function student(i) {
  return {
    credentialId: `COR-2026-B${String(i).padStart(5, '0')}`,
    studentName: `Batch Student ${i}`,
    studentId: `AU24CS${String(i).padStart(4, '0')}`,
    credentialType: 'B.Tech in Computer Science & Engineering',
    issueDate: '2026-06-15',
  };
}

describe('Merkle batch issuance', () => {
  describe('merkle.js', () => {
    it('leafOf matches the contract implementation', async () => {
      const registry = await ethers.deployContract('CredentialRegistry', ['Alliance University']);
      expect(leafOf('COR-1', hashOf(7))).to.equal(await registry.leafOf('COR-1', hashOf(7)));
    });

    for (const size of [1, 2, 3, 7, 8, 33]) {
      it(`builds proofs the contract accepts for a ${size}-leaf tree`, async () => {
        const registry = await ethers.deployContract('CredentialRegistry', ['Alliance University']);
        const items = Array.from({ length: size }, (_, i) => [`COR-${i}`, hashOf(i + 1)]);
        const tree = buildMerkleTree(items.map(([id, h]) => leafOf(id, h)));
        await registry.anchorBatch(tree.root, size);
        for (let i = 0; i < size; i++) {
          const r = await registry.verifyBatchCredential(1, items[i][0], items[i][1], tree.proof(i));
          expect(r.included, `leaf ${i}`).to.equal(true);
        }
      });
    }
  });

  describe('contract', () => {
    let registry, tree, items, outsider;

    beforeEach(async () => {
      [, outsider] = await ethers.getSigners();
      registry = await ethers.deployContract('CredentialRegistry', ['Alliance University']);
      items = Array.from({ length: 5 }, (_, i) => [`COR-${i}`, hashOf(i + 1)]);
      tree = buildMerkleTree(items.map(([id, h]) => leafOf(id, h)));
      await expect(registry.anchorBatch(tree.root, 5)).to.emit(registry, 'BatchAnchored');
    });

    it('rejects a wrong proof, a wrong hash and an unknown batch', async () => {
      expect((await registry.verifyBatchCredential(1, 'COR-0', hashOf(1), tree.proof(1))).included).to.equal(false);
      expect((await registry.verifyBatchCredential(1, 'COR-0', hashOf(99), tree.proof(0))).included).to.equal(false);
      expect((await registry.verifyBatchCredential(9, 'COR-0', hashOf(1), tree.proof(0))).included).to.equal(false);
    });

    it('refuses to anchor the same root twice or an empty batch', async () => {
      await expect(registry.anchorBatch(tree.root, 5)).to.be.revertedWithCustomError(registry, 'RootAlreadyAnchored');
      await expect(registry.anchorBatch(ethers.ZeroHash, 1)).to.be.revertedWithCustomError(registry, 'EmptyValue');
      await expect(registry.anchorBatch(hashOf(5), 0)).to.be.revertedWithCustomError(registry, 'EmptyValue');
    });

    it('only authorized issuers can anchor', async () => {
      await expect(registry.connect(outsider).anchorBatch(hashOf(1), 1)).to.be.revertedWithCustomError(
        registry,
        'NotAuthorizedIssuer'
      );
    });

    it('revokes one member of a batch without affecting the others', async () => {
      await expect(registry.revokeBatchCredential(1, 'COR-2', hashOf(3), tree.proof(2), reason('error')))
        .to.emit(registry, 'CredentialRevoked');
      expect((await registry.verifyBatchCredential(1, 'COR-2', hashOf(3), tree.proof(2))).revokedAt).to.be.greaterThan(0n);
      expect((await registry.verifyBatchCredential(1, 'COR-3', hashOf(4), tree.proof(3))).revokedAt).to.equal(0n);
      await expect(
        registry.revokeBatchCredential(1, 'COR-2', hashOf(3), tree.proof(2), reason('again'))
      ).to.be.revertedWithCustomError(registry, 'AlreadyRevoked');
      await expect(
        registry.revokeBatchCredential(1, 'COR-4', hashOf(5), tree.proof(0), reason('x'))
      ).to.be.revertedWithCustomError(registry, 'InvalidProof');
    });

    it('costs far less gas per credential than individual issuance', async () => {
      const batchTree = buildMerkleTree(Array.from({ length: 100 }, (_, i) => leafOf(`B-${i}`, hashOf(1000 + i))));
      const batchReceipt = await (await registry.anchorBatch(batchTree.root, 100)).wait();
      const single = await (await registry.issueCredential('SINGLE-1', hashOf(5000))).wait();
      const perCredential = Number(batchReceipt.gasUsed) / 100;
      expect(perCredential).to.be.lessThan(Number(single.gasUsed) / 50);
    });
  });

  describe('API', () => {
    let registry, app, token;

    beforeEach(async () => {
      registry = await ethers.deployContract('CredentialRegistry', ['Alliance University']);
      app = await buildApp(registry);
      token = await login(app, 'registrar.admin', 'admin12345');
    });

    const issueBatch = (credentials) =>
      request(app).post('/api/credentials/batch').set('Authorization', `Bearer ${token}`).send({ credentials });

    it('issues a batch in one transaction and verifies each member by ID and by file', async () => {
      const res = await issueBatch([1, 2, 3, 4, 5].map(student));
      expect(res.status, JSON.stringify(res.body)).to.equal(201);
      expect(res.body.count).to.equal(5);
      expect(await registry.batchCount()).to.equal(1n);

      for (const c of res.body.credentials) {
        const byId = await request(app).get(`/api/verify/${c.credentialId}`);
        expect(byId.body.status).to.equal('valid');
        expect(byId.body.details.onChain.batchId).to.equal(1);

        const record = (await request(app).get(`/api/credentials/${c.credentialId}`)).body;
        const pdf = Buffer.from(buildCertificateBytes(record));
        const byFile = await request(app).post('/api/verify/file').set('Content-Type', 'application/pdf').send(pdf);
        expect(byFile.body.status).to.equal('valid');
      }
    });

    it('detects a tampered batch certificate', async () => {
      const res = await issueBatch([1, 2, 3].map(student));
      const record = (await request(app).get(`/api/credentials/${res.body.credentials[0].credentialId}`)).body;
      const forged = Buffer.from(buildCertificateBytes({ ...record, studentName: 'Someone Else' }));
      const verdict = await request(app).post('/api/verify/file').set('Content-Type', 'application/pdf').send(forged);
      expect(verdict.body.status).to.equal('invalid');
    });

    it('revokes a batch member on-chain and shows it in the history', async () => {
      const res = await issueBatch([1, 2, 3].map(student));
      const id = res.body.credentials[1].credentialId;
      const rev = await request(app)
        .post(`/api/credentials/${id}/revoke`)
        .set('Authorization', `Bearer ${token}`)
        .send({ reason: 'Wrong programme' });
      expect(rev.status).to.equal(200);

      expect((await request(app).get(`/api/verify/${id}`)).body.status).to.equal('revoked');
      expect((await request(app).get(`/api/verify/${res.body.credentials[0].credentialId}`)).body.status).to.equal(
        'valid'
      );
      const history = (await request(app).get(`/api/credentials/${id}/history`)).body.events;
      expect(history.map((e) => e.type)).to.deep.equal(['batch_anchored', 'revoked']);
    });

    it('rejects duplicates inside a batch and IDs that already exist, before touching the chain', async () => {
      const dup = await issueBatch([student(1), student(1)]);
      expect(dup.status).to.equal(409);
      await issueBatch([student(2)]);
      const existing = await issueBatch([student(3), student(2)]);
      expect(existing.status).to.equal(409);
      expect(await registry.batchCount()).to.equal(1n);
    });

    it('validates every item and caps the batch size', async () => {
      const bad = await issueBatch([student(1), { ...student(2), studentName: '' }]);
      expect(bad.status).to.equal(400);
      expect(bad.body.error).to.match(/^Item 1:/);
      const tooBig = await issueBatch(Array.from({ length: 501 }, (_, i) => student(i)));
      expect(tooBig.status).to.equal(400);
    });
  });
});
