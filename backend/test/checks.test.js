// Checks that the mutation run showed were not yet pinned down by any test:
// each test fails if its check is removed.

import { expect } from 'chai';
import {
  BlockchainNetwork,
  addressOf,
  checkTransaction,
  createTransaction,
  hashHeader,
  meetsDifficulty,
  replayChain,
  sha256,
  transactionId,
} from '../blockchain/index.js';
import { deriveValidatorKeys } from '../server/ledger.js';
import { createInstitutionService } from '../server/institutions.js';
import { createMemoryStore } from '../server/store.js';
import { verifyCertificateEvidence } from '../server/photoVerify.js';
import { marksString, verifyUrl } from '../../src/lib/certificateView.js';

const key = (name) => `0x${sha256(`checks-${name}`)}`;
const AUTHORITY = key('authority');
const UNI = key('uni');
const OTHER = key('other');
const issue = (id, certHash, signer = UNI) => createTransaction('ISSUE', { credentialId: id, certHash }, signer);
const ruleOf = (fn) => {
  try {
    fn();
  } catch (err) {
    return err.reason ?? err.message;
  }
  return null;
};

function buildNetwork() {
  const net = new BlockchainNetwork(deriveValidatorKeys('checks'));
  const add = (...txs) => net.commit(net.propose(txs));
  add(net.genesisTransaction({ authorityKey: AUTHORITY, authorityName: 'Platform', chainName: 'Checks', difficulty: 2 }));
  add(createTransaction('SET_ISSUER', { address: addressOf(UNI), name: 'Uni', active: true }, AUTHORITY));
  return { net, add };
}

describe('Checks pinned by the mutation run', () => {
  describe('chain rules', () => {
    it('rejects an empty hash, a reused ID with a new hash, and any issue while paused', () => {
      const { net, add } = buildNetwork();
      expect(ruleOf(() => net.propose([issue('X', '')]))).to.equal('EmptyValue');
      add(issue('X', sha256('x1')));
      expect(ruleOf(() => net.propose([issue('X', sha256('x2'))]))).to.equal('CredentialAlreadyExists');
      add(createTransaction('SET_PAUSED', { paused: true }, AUTHORITY));
      expect(ruleOf(() => net.propose([issue('Y', sha256('y'))]))).to.equal('EnforcedPause');
    });

    it('rejects a block whose hash does not meet the proof-of-work difficulty', () => {
      const { net } = buildNetwork();
      const copy = structuredClone(net.leader.blocks);
      const header = copy[1].header;
      do {
        header.nonce += 1;
        copy[1].hash = hashHeader(header);
      } while (meetsDifficulty(copy[1].hash, header.difficulty));
      expect(replayChain(copy, { deep: false }).problem).to.equal('proof_of_work_invalid');
    });

    it("rejects a transaction signed by someone other than its sender, or edited after signing", () => {
      const signedByOther = issue('Z', sha256('z'), OTHER);
      const impersonating = { ...signedByOther, from: addressOf(UNI) };
      impersonating.id = transactionId(impersonating);
      expect(checkTransaction(impersonating)).to.equal('signature was not made by the sender');

      const edited = structuredClone(issue('Z', sha256('z')));
      edited.payload.certHash = sha256('edited');
      expect(checkTransaction(edited)).to.equal('transaction id does not match its contents');
    });
  });

  describe('institutions', () => {
    it('does not trust a suspended institution, even while its chain address is still active', async () => {
      const store = createMemoryStore();
      const address = addressOf(OTHER);
      await store.createInstitution({ id: 'college', name: 'College', status: 'suspended', kind: 'university', walletAddress: address });
      const service = createInstitutionService({
        chain: { owner: async () => addressOf(AUTHORITY) },
        connect: () => null,
        store,
        walletKey: Buffer.alloc(32),
        fundingWei: 0n,
        rootName: 'Platform',
        trustedIssuer: addressOf(AUTHORITY),
      });
      expect(await service.trustedByAddress(address)).to.equal(null);
      await store.updateInstitution('college', { status: 'approved' });
      expect((await service.trustedByAddress(address))?.id).to.equal('college');
    });
  });

  describe('photo verdicts', () => {
    const rows = [
      { semester: 1, credits_earned: 20, sgpa: 7.38, result: 'PASS', backlogs: 0 },
      { semester: 2, credits_earned: 20, sgpa: 8.1, result: 'PASS', backlogs: 0 },
    ];
    const canonical = 'U/DC/2024/000001|R1|ASHA RAO|2003-01-02|U-BE-CS|8.00|2024|U1';
    const degree = {
      canonical_string: canonical, reg_no: 'R1', candidate_name: 'ASHA RAO', dob: '2003-01-02', cgpa_or_percent: 8,
      year_of_passing: 2024, certificate_serial_no: 'U/DC/2024/000001', credential_id: 'U-1', enrollment_id: 'E1',
      certificate_status: 'ISSUED', degree_name: 'B.E.', branch: 'CS', university: 'Test University',
    };
    const onChain = { txId: 't', certHash: sha256(canonical), marksHash: sha256(marksString(rows)), status: 'valid', issuer: '0x1', consensus: { agree: 3, total: 3 } };
    const deps = (over = {}) => ({
      findDegree: async () => degree,
      findCredential: async () => null,
      ledgerGet: async () => onChain,
      issuerTrusted: async () => ({ name: 'Test University' }),
      proof: async () => null,
      findMarks: async () => rows,
      ...over,
    });
    const header = 'Certificate No: U/DC/2024/000001\nUniversity: Test University\nRegister No: R1\nStudent Name: ASHA RAO\nDate of Birth: 2003-01-02\nDegree: B.E.\nBranch: CS\nCGPA or Percentage: 8.00\nYear of Passing: 2024\n';
    const card = `${header}Sem 1 20 7.38 PASS 0\nSem 2 20 8.10 PASS 0\n`;

    it('is VALID for the genuine card (baseline for the cases below)', async () => {
      expect((await verifyCertificateEvidence({ ocrText: card }, deps())).verdict).to.equal('valid');
    });
    it('is INVALID when the chain walk from the certificate block is broken', async () => {
      const r = await verifyCertificateEvidence({ ocrText: card }, deps({ proof: async () => ({ block: 3, chainWalk: { valid: false, brokenAt: 5 } }) }));
      expect(r).to.include({ verdict: 'invalid', code: 'chain_broken' });
    });
    it('is INVALID when the issuer is not trusted', async () => {
      const r = await verifyCertificateEvidence({ ocrText: card }, deps({ issuerTrusted: async () => null }));
      expect(r).to.include({ verdict: 'invalid', code: 'untrusted_issuer' });
    });
    it('is INVALID, not VALID, when a semester row cannot be read', async () => {
      const r = await verifyCertificateEvidence({ ocrText: `${header}Sem 1 20 7.38 PASS 0\nSem 2 20 ~~~~ 0\n` }, deps());
      expect(r).to.include({ verdict: 'invalid', code: 'fields_unreadable' });
    });
    it("is INVALID when the QR code's hash differs from the chain", async () => {
      const qrText = verifyUrl('https://x.test', 'U/DC/2024/000001', 'b'.repeat(64));
      const r = await verifyCertificateEvidence({ ocrText: card, qrText }, deps());
      expect(r).to.include({ verdict: 'invalid', code: 'qr_hash_mismatch' });
    });
  });
});
