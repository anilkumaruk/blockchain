// Imports the Fluree Academic Credentials Dataset (data/fluree-acd) into the
// configured database (e.g. Supabase) and anchors every credential on-chain
// under its issuing institution's own wallet.
//
//   npm run import:fluree
//
// Safe to re-run: institutions, students and credentials that already exist
// are skipped. Needs the chain running and the registry deployed, like
// `npm start`.

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Contract, JsonRpcProvider, Wallet } from 'ethers';
import { loadConfig } from '../server/config.js';
import { createChainBridge } from '../server/chain.js';
import { createPgStore } from '../server/store.js';
import { createInstitutionService } from '../server/institutions.js';
import { slugify } from '../server/wallets.js';
import { buildCertificateBytes, computeSha256Hex } from '../../src/lib/generateCertificatePdf.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(here, '..', 'data', 'fluree-acd');
const SOURCE = 'fluree-acd';

const { config, errors } = loadConfig();
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
if (config.useMemoryStore) {
  console.error('Set DATABASE_URL: importing into the in-memory store would be lost immediately.');
  process.exit(1);
}

const read = (f) => JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8')).insert;
const profiles = read('01_profiles.jsonld');
const achievements = new Map(read('02_achievements.jsonld').map((a) => [a.id, a]));
const credentials = read('03_credentials.jsonld');

const deployment = JSON.parse(
  fs.readFileSync(path.join(here, '..', 'deployments', `${config.network}.json`), 'utf8')
);
const provider = new JsonRpcProvider(config.rpcUrl, deployment.chainId, { staticNetwork: true, cacheTimeout: -1 });
const contract = new Contract(config.contractAddress || deployment.address, deployment.abi, new Wallet(config.issuerKey, provider));
const bridgeOptions = { fromBlock: deployment.blockNumber ?? 0 };
const store = await createPgStore(config.databaseUrl, { ssl: config.databaseSsl });
const institutions = createInstitutionService({
  chain: createChainBridge(contract, bridgeOptions),
  connect: (pk) => createChainBridge(contract.connect(new Wallet(pk, provider)), bridgeOptions),
  store,
  walletKey: config.walletKey,
  fundingWei: config.fundingWei,
  rootName: config.institutionName,
  trustedIssuer: config.trustedIssuer,
});
await institutions.root();

// ---- institutions --------------------------------------------------------
const CERTIFYING = new Set(['ncees', 'pearsonvue', 'ncsite', 'asce', 'ascenc', 'ncbels']);
const instByRef = new Map(); // Fluree IRI -> our institution row
const counts = { institutions: 0, employers: 0, students: 0, credentials: 0, skipped: 0 };

const orgProfiles = profiles.filter((p) => p['acd:profileType'] !== 'Learner');
// Referenced by a credential but missing from the profiles file.
if (!orgProfiles.some((p) => p.id === 'acd:institutions/ncbels')) {
  orgProfiles.push({
    id: 'acd:institutions/ncbels',
    'acd:profileType': 'Institution',
    'schema:name': 'North Carolina Board of Examiners for Engineers and Surveyors',
    derived: true,
  });
}

for (const p of orgProfiles) {
  const name = p['schema:name'];
  const ref = p.id.split('/').pop();
  const employer = p['acd:profileType'] === 'Employer';
  let inst = (await store.getInstitution(slugify(name))) ?? (await store.findInstitutionByName(name));
  if (!inst) {
    inst = await store.createInstitution({
      id: slugify(name),
      name,
      kind: employer ? 'employer' : CERTIFYING.has(ref) ? 'certifying_body' : 'university',
      website: p['schema:url'] ?? null,
      status: employer ? 'approved' : 'pending',
      source: p.derived ? `${SOURCE} (derived from credential reference)` : SOURCE,
      ...(employer ? { approvedAt: new Date().toISOString(), approvedBy: 'import' } : {}),
    });
    counts[employer ? 'employers' : 'institutions']++;
  }
  // Issuers get their own wallet, authorized and funded on-chain.
  if (!employer && inst.status !== 'approved') inst = await institutions.approve(inst.id, 'import:fluree-acd');
  instByRef.set(p.id, await store.getInstitution(inst.id));
  console.log(`institution  ${inst.status.padEnd(9)} ${inst.walletAddress ?? '(no wallet)'}  ${name}`);
}

// ---- students ------------------------------------------------------------
const learnerId = (iri) => `ACD-${iri.split('/').pop().toUpperCase()}`;
const firstIssuerOf = (iri) =>
  credentials.find((c) => c['clr:credentialSubject']['acd:recipient'].id === iri)?.['clr:issuer'].id;

const learners = new Map();
for (const p of profiles.filter((x) => x['acd:profileType'] === 'Learner')) {
  const fullName = `${p['schema:givenName']} ${p['schema:familyName']}`;
  const issuerRef = firstIssuerOf(p.id);
  const existed = await store.getStudent(learnerId(p.id));
  await store.upsertStudent({
    studentId: learnerId(p.id),
    fullName,
    email: p['schema:email'],
    institutionId: issuerRef ? instByRef.get(issuerRef).id : null,
    source: SOURCE,
  });
  if (!existed) counts.students++;
  learners.set(p.id, { studentId: learnerId(p.id), fullName });
  console.log(`student      ${learnerId(p.id).padEnd(24)} ${fullName} <${p['schema:email']}>`);
}

// ---- credentials -----------------------------------------------------------
const contractAddress = await contract.getAddress();
for (const c of credentials) {
  const credentialId = `ACD-CRED-${String(c.id.split('/').pop()).padStart(4, '0')}`;
  if (await store.get(credentialId)) {
    counts.skipped++;
    continue;
  }
  const subject = c['clr:credentialSubject'];
  const learner = learners.get(subject['acd:recipient'].id);
  const ach = achievements.get(subject['clr:achievement'].id);
  const inst = instByRef.get(c['clr:issuer'].id);
  const code = ach['clr:humanCode'] ? ` (${ach['clr:humanCode']})` : '';
  const fields = {
    credentialId,
    studentName: learner.fullName,
    studentId: learner.studentId,
    credentialType: `${ach['clr:achievementType']}: ${ach['clr:name']}${code}`.slice(0, 200),
    issueDate: c['clr:issuanceDate'],
    issuer: inst.name,
    txHash: '0x' + Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex'),
  };
  const hash = await computeSha256Hex(buildCertificateBytes(fields));
  const receipt = await (await institutions.bridgeFor(inst)).issue(credentialId, hash);
  await store.insert({
    ...fields,
    institutionId: inst.id,
    issuerAddress: inst.walletAddress,
    hash,
    status: 'valid',
    revocation: null,
    chain: {
      mode: 'individual',
      txHash: receipt.txHash,
      blockNumber: receipt.blockNumber,
      gasUsed: String(receipt.gasUsed),
      contract: contractAddress,
      source: SOURCE,
      sourceId: c.id,
    },
  });
  counts.credentials++;
  console.log(`credential   ${credentialId}  ${inst.name.slice(0, 32).padEnd(32)} ${fields.credentialType.slice(0, 50)}`);
}

await store.addAudit({ actor: 'import:fluree-acd', action: 'dataset_imported', target: SOURCE, details: counts });
console.log('\nImported:', counts);
await store.close();
