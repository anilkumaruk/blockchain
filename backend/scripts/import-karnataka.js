// Imports the Karnataka Degree Registry (data/karnataka/*.json) into the
// database and records every degree certificate in the CredentialRegistry
// smart contract on Ethereum:
//   - each university gets its own test wallet; the platform (contract owner)
//     authorises it with setIssuer and sends it a little test ETH for gas
//   - each university signs ONE Merkle batch (anchorBatch) covering all its
//     certificates; every certificate keeps its Merkle proof in the database.
//     The leaf is the certificate's document hash: SHA-256 of its canonical
//     line plus every semester row (server/hash.js)
//   - REVOKED / WITHHELD / CANCELLED_DUPLICATE_ISSUED certificates are revoked
//     by their own university (revokeBatchCredential) with the dataset's reason
//   - all academic tables (colleges, programs, students, enrollments,
//     semester results, NAD export, verification requests) are loaded
//   - 1 platform admin, 5 university admin and 15 student test logins are
//     created; passwords and the universities' MetaMask test keys are written
//     to data/karnataka/TEST_LOGINS.md and TEST_WALLETS.json (git-ignored)
//
//   npm run import:karnataka        (CHAIN_NETWORK=localhost or sepolia)
//
// This is an operator tool run on your own machine: it signs with the
// platform owner's key (DEPLOYER_PRIVATE_KEY, or Hardhat's public dev key on
// localhost) and the universities' test keys. The API server never holds keys.
//
// Resumable: if a run is interrupted, run it again. Every phase skips what is
// already done (authorised issuers, anchored universities, revoked certificates).
// For a clean start: node scripts/reset-db.js --confirm, then deploy a new contract.

import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Contract, JsonRpcProvider, NonceManager, Wallet, formatEther, keccak256, parseEther, toUtf8Bytes } from 'ethers';
import { HARDHAT_DEV_KEY, loadConfig } from '../server/config.js';
import { createPgStore } from '../server/store.js';
import { slugify } from '../server/institutions.js';
import { hashPassword, verifyPassword } from '../server/passwords.js';
import { documentHash } from '../server/hash.js';
import { buildMerkleTree, leafOf } from '../server/merkle.js';
import { normalizeReason } from '../server/app.js';
import { degreeCanonical } from '../../src/lib/certificateView.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(here, '..', 'data', 'karnataka');
const SOURCE = 'karnataka-degree-registry';
const load = (name) => JSON.parse(fs.readFileSync(path.join(DATA, `${name}.json`), 'utf8'));

const { config, errors } = loadConfig();
if (errors.length || config.useMemoryStore) {
  console.error(errors.join('\n') || 'Set DATABASE_URL to import.');
  process.exit(1);
}

const store = await createPgStore(config.databaseUrl, { ssl: config.databaseSsl });
const deployment = JSON.parse(fs.readFileSync(path.join(here, '..', 'deployments', `${config.network}.json`), 'utf8'));
const provider = new JsonRpcProvider(config.rpcUrl, deployment.chainId, { staticNetwork: true });
const ownerKey = config.network === 'localhost' ? HARDHAT_DEV_KEY : process.env.DEPLOYER_PRIVATE_KEY;
if (!ownerKey) {
  console.error('Set DEPLOYER_PRIVATE_KEY (the contract owner) in backend/.env to import onto Sepolia.');
  process.exit(1);
}
const owner = new NonceManager(new Wallet(ownerKey, provider));
const asOwner = new Contract(deployment.address, deployment.abi, owner);
console.log(`Contract ${deployment.address} on ${config.network}; owner ${await owner.getAddress()}`);

// Each university's MetaMask test key. Generated once and kept, so reruns and
// the registrars' MetaMask imports keep working.
const walletsFile = path.join(DATA, 'TEST_WALLETS.json');
const walletKeys = fs.existsSync(walletsFile) ? JSON.parse(fs.readFileSync(walletsFile, 'utf8')) : {};
const signerFor = (univId) => {
  if (!walletKeys[univId]) {
    walletKeys[univId] = Wallet.createRandom().privateKey;
    fs.writeFileSync(walletsFile, JSON.stringify(walletKeys, null, 2), { mode: 0o600 });
  }
  return new NonceManager(new Wallet(walletKeys[univId], provider));
};
const FUNDING = parseEther(process.env.UNIVERSITY_FUNDING_ETH || (config.network === 'localhost' ? '1' : '0.0005'));
const mined = async (txPromise) => (await txPromise).wait();

const yn = (v) => (v === 'Y' ? true : v === 'N' ? false : null);
const isoDate = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

/** Multi-row parameterized INSERT in chunks; rows that already exist are skipped. */
async function insertRows(table, columns, rows, chunk = 400) {
  for (let i = 0; i < rows.length; i += chunk) {
    const part = rows.slice(i, i + chunk);
    const params = [];
    const values = part.map((r) => `(${columns.map((c) => (params.push(r[c] ?? null), `$${params.length}`)).join(', ')})`);
    await store.raw(
      `INSERT INTO ${table} (${columns.join(', ')}) VALUES ${values.join(', ')} ON CONFLICT DO NOTHING`,
      params
    );
  }
  console.log(`  ${table.padEnd(22)} ${rows.length}`);
}

// ---- universities -> approved institutions with their own wallet -------------
console.log('Universities');
const univById = new Map();
const signerByUniv = new Map();
for (const u of load('universities')) {
  const signer = signerFor(u.univ_id);
  const address = await signer.getAddress();
  const id = slugify(u.univ_name);
  const attrs = {
    kind: 'university', website: null, source: SOURCE, sourceRef: u.univ_id, shortCode: u.short_code, univType: u.univ_type,
    regulator: u.regulator, city: u.city, state: u.state, pincode: u.pincode, establishedYear: u.established_year,
    gradingSystem: u.grading_system, aisheCode: u.aishe_code, ugcRecognised: yn(u.ugc_recognised),
  };
  if (!(await store.getInstitution(id))) await store.createInstitution({ id, name: u.univ_name, status: 'pending', ...attrs });
  // The platform authorises the university's wallet in the contract...
  if (!(await asOwner.issuers(address)).active) await mined(asOwner.setIssuer(address, u.univ_name, true));
  // ...and gives it a little test ETH so it can pay for its own transactions.
  if ((await provider.getBalance(address)) < FUNDING / 2n) await mined(owner.sendTransaction({ to: address, value: FUNDING }));
  await store.updateInstitution(id, { walletAddress: address, walletKeyEnc: null, status: 'approved', approvedBy: `import:${SOURCE}`, ...attrs });
  univById.set(u.univ_id, await store.getInstitution(id));
  signerByUniv.set(u.univ_id, signer);
  console.log(`  ${u.short_code.padEnd(8)} ${address}  ${u.univ_name}`);
}
console.log(`  owner balance left: ${formatEther(await provider.getBalance(await owner.getAddress()))} ETH`);
const instId = (univId) => univById.get(univId).id;

const certs = load('degree_certificates');
const certNo = (d) => d.certificate_serial_no || d.provisional_cert_no;
const students = load('students');

// LOGINS_ONLY=1 creates any missing test accounts and stops (existing ones keep
// their passwords) - useful while the long on-chain part is still running.
// Add RESET_LOGINS=1 to give every account a new password.
if (process.env.LOGINS_ONLY === '1') {
  await createLogins({ reset: process.env.RESET_LOGINS === '1' });
  await store.close();
  process.exit(0);
}

// ---- colleges, programs ----------------------------------------------------
console.log('Academic records');
await insertRows(
  'colleges',
  ['college_code', 'college_name', 'institution_id', 'city', 'autonomous', 'established_year', 'source'],
  load('colleges').map((c) => ({ ...c, institution_id: instId(c.univ_id), autonomous: yn(c.autonomous), source: SOURCE }))
);
await insertRows(
  'programs',
  ['program_id', 'institution_id', 'program_code', 'degree_level', 'degree_name', 'branch_code', 'branch_name',
    'duration_years', 'total_credits', 'admission_modes'],
  load('programs').map((p) => ({ ...p, institution_id: instId(p.univ_id) }))
);

// ---- students, enrollments, semester results ---------------------------------
const enrollments = load('enrollments');
const univOfStudent = new Map(enrollments.map((e) => [e.student_id, e.univ_id]));
await insertRows(
  'students',
  ['student_id', 'full_name', 'email', 'institution_id', 'source', 'reg_no', 'abc_apaar_id', 'father_name',
    'mother_name', 'dob', 'gender', 'nationality', 'category', 'domicile', 'aadhaar_masked', 'mobile_masked', 'photo_ref'],
  students.map((s) => ({
    ...s,
    email: s.email?.toLowerCase(),
    dob: isoDate(s.dob),
    institution_id: univOfStudent.has(s.student_id) ? instId(univOfStudent.get(s.student_id)) : null,
    source: SOURCE,
  }))
);
await insertRows(
  'enrollments',
  ['enrollment_id', 'student_id', 'reg_no', 'institution_id', 'college_code', 'program_id', 'admission_year',
    'academic_session', 'admission_quota', 'lateral_entry', 'medium', 'status', 'semesters_completed'],
  enrollments.map((e) => ({ ...e, institution_id: instId(e.univ_id), lateral_entry: yn(e.lateral_entry) }))
);
await insertRows(
  'semester_results',
  ['enrollment_id', 'semester', 'exam_session', 'result_date', 'credits_registered', 'credits_earned', 'sgpa',
    'backlogs', 'result'],
  load('semester_results').map((r) => ({ ...r, result_date: isoDate(r.result_date) })),
  800
);

// ---- degree certificates -> one Merkle batch per university, signed by it -----
console.log('Degree certificates -> smart contract');
const groupByEnrollment = (rows) => {
  const map = new Map();
  for (const r of rows) map.set(r.enrollment_id, [...(map.get(r.enrollment_id) ?? []), r]);
  return map;
};
const credIdOf = (no) => no.replace(/\//g, '-');
const semestersByEnrollment = groupByEnrollment(load('semester_results'));
const univName = new Map(load('universities').map((u) => [u.univ_id, u.univ_name]));
const byCertNo = new Map(certs.map((d) => [certNo(d), d]));
const credentialOf = new Map(); // certificate_id -> credential record
const batchEvent = (receipt) =>
  receipt.logs.map((l) => { try { return asOwner.interface.parseLog(l); } catch { return null; } }).find((e) => e?.name === 'BatchAnchored');

for (const [univId, inst] of univById) {
  const mine = certs.filter((d) => d.univ_id === univId);
  if (!mine.length) continue;
  const done = await store.raw('SELECT * FROM credentials WHERE institution_id = $1', [inst.id]);
  if (done.rows.length === mine.length) {
    const byNo = new Map(done.rows.map((r) => [r.certificate_no, r]));
    for (const d of mine) {
      const r = byNo.get(certNo(d));
      credentialOf.set(d.certificate_id, { credentialId: r.credential_id, hash: r.doc_hash, batch: r.batch, issueDate: r.issue_date, status: r.status });
    }
    console.log(`  ${inst.shortCode.padEnd(8)} already anchored (${mine.length}), skipped`);
    continue;
  }
  // The document hash of each certificate, exactly as the API and the photo check recompute it.
  const hashes = mine.map((d) => documentHash(degreeCanonical(d), semestersByEnrollment.get(d.enrollment_id) ?? []));
  const ids = mine.map((d) => credIdOf(certNo(d)));
  const tree = buildMerkleTree(mine.map((_, i) => leafOf(ids[i], hashes[i])));
  const asUniversity = new Contract(deployment.address, deployment.abi, signerByUniv.get(univId));
  const receipt = await mined(asUniversity.anchorBatch(tree.root, mine.length));
  const batchId = Number(batchEvent(receipt).args.batchId);

  const records = mine.map((d, i) => ({
    credentialId: ids[i],
    certificateNo: certNo(d),
    studentName: d.candidate_name,
    studentId: d.student_id,
    credentialType: `${d.degree_name}${d.branch && d.branch !== d.degree_name ? ` in ${d.branch}` : ''}${
      d.certificate_status === 'PROVISIONAL_ONLY' ? ' (Provisional)' : ''
    }`.slice(0, 200),
    issueDate: isoDate(d.date_of_issue) ?? isoDate(d.provisional_issue_date),
    issuer: inst.name,
    txHash: receipt.hash,
    hash: hashes[i],
    status: 'valid',
    revocation: null,
    institutionId: inst.id,
    issuerAddress: inst.walletAddress,
    batch: { batchId, root: tree.root, proof: tree.proof(i), index: i },
    chain: { mode: 'batch', network: config.network, contract: deployment.address, txHash: receipt.hash, blockNumber: receipt.blockNumber, source: SOURCE, sourceId: d.certificate_id },
  }));
  await store.insertMany(records);
  records.forEach((r, i) => credentialOf.set(mine[i].certificate_id, r));
  console.log(`  ${inst.shortCode.padEnd(8)} ${records.length} certificates, batch ${batchId}, block ${receipt.blockNumber}`);
}

// Revoke what the registry says is not valid, signed by the issuing university with the registry's reason.
let revoked = 0;
const reasonOf = (d) => normalizeReason(d.certificate_status === 'WITHHELD' ? `Withheld: ${d.revocation_reason}` : d.revocation_reason);
for (const [univId, inst] of univById) {
  const list = certs
    .filter((c) => c.univ_id === univId && ['REVOKED', 'WITHHELD', 'CANCELLED_DUPLICATE_ISSUED'].includes(c.certificate_status))
    .map((d) => ({ d, rec: credentialOf.get(d.certificate_id), reason: reasonOf(d) }))
    .filter((t) => t.rec.status !== 'revoked');
  if (!list.length) continue;
  const asUniversity = new Contract(deployment.address, deployment.abi, signerByUniv.get(univId));
  // Send them all, then wait: one block on Sepolia can hold many.
  const pending = [];
  for (const t of list) {
    const { batchId, proof } = t.rec.batch;
    const state = await asUniversity.verifyBatchCredential(batchId, t.rec.credentialId, t.rec.hash, proof);
    if (Number(state.revokedAt) === 0) {
      pending.push([t, await asUniversity.revokeBatchCredential(batchId, t.rec.credentialId, t.rec.hash, proof, keccak256(toUtf8Bytes(t.reason)))]);
    } else pending.push([t, null]);
  }
  for (const [t, tx] of pending) {
    const receipt = tx ? await tx.wait() : null;
    const patch = {
      status: 'revoked',
      revocation: { reason: t.reason, date: t.rec.issueDate, txHash: receipt?.hash ?? null, blockNumber: receipt?.blockNumber ?? null },
    };
    const superseded = /^Superseded by (\S+)/.exec(t.d.revocation_reason || '');
    if (superseded && byCertNo.has(superseded[1])) patch.replacedBy = credIdOf(superseded[1]);
    await store.update(t.rec.credentialId, patch);
    revoked++;
  }
  console.log(`  ${inst.shortCode.padEnd(8)} revoked ${list.length}`);
}
// Duplicates issued for lost originals point back to the cancelled original.
for (const d of certs) {
  const dup = /^Duplicate of (\S+)/.exec(d.revocation_reason || '');
  if (dup && byCertNo.has(dup[1])) await store.update(credentialOf.get(d.certificate_id).credentialId, { replaces: credIdOf(dup[1]) });
}
console.log(`  revoked in the contract: ${revoked}`);

console.log('Registry tables');
await insertRows(
  'degree_certificates',
  ['certificate_id', 'credential_id', 'certificate_serial_no', 'provisional_cert_no', 'consolidated_marks_card_no',
    'enrollment_id', 'student_id', 'reg_no', 'institution_id', 'college_code', 'program_id', 'degree_level',
    'degree_name', 'branch', 'candidate_name', 'dob', 'total_credits_earned', 'cgpa_or_percent', 'grading_system',
    'equivalent_percentage', 'class_awarded', 'month_of_passing', 'year_of_passing', 'provisional_issue_date',
    'convocation_no', 'convocation_date', 'date_of_issue', 'signed_by', 'certificate_status', 'revocation_reason',
    'nad_uploaded', 'digilocker_uri', 'canonical_string', 'sha256_hash'],
  certs.map((d) => ({
    ...d,
    credential_id: credentialOf.get(d.certificate_id).credentialId,
    institution_id: instId(d.univ_id),
    dob: isoDate(d.dob),
    provisional_issue_date: isoDate(d.provisional_issue_date),
    convocation_date: isoDate(d.convocation_date),
    date_of_issue: isoDate(d.date_of_issue),
    nad_uploaded: yn(d.nad_uploaded),
  }))
);
const nadCount = Number((await store.raw('SELECT count(*) FROM nad_awards')).rows[0].count);
if (nadCount === 0) await insertRows(
  'nad_awards',
  ['org_name', 'org_code', 'org_address', 'org_city', 'org_state', 'org_pin', 'academic_course_id', 'course_name',
    'stream', 'session', 'regn_no', 'rroll', 'abc_account_id', 'cname', 'gender', 'dob', 'fname', 'mname', 'photo',
    'result', 'year', 'month', 'division', 'cgpa', 'percent', 'tot_credit', 'doi', 'cert_no', 'cert_type',
    'department', 'univ_name'],
  load('nad_award_export').map((n) => Object.fromEntries(Object.entries(n).map(([k, v]) => [k.toLowerCase(), v])))
);
await insertRows(
  'verification_requests',
  ['request_id', 'request_date', 'requester', 'claimed_certificate_no', 'claimed_reg_no', 'claimed_name',
    'claimed_dob', 'claimed_university', 'claimed_degree', 'claimed_branch', 'claimed_cgpa_or_percent',
    'claimed_year_of_passing', 'qr_hash_on_document', 'expected_result', 'failure_reason'],
  load('verification_requests').map((v) => ({ ...v, request_date: isoDate(v.request_date) }))
);

// ---- test logins ------------------------------------------------------------
// Created once; later runs keep the existing passwords (and TEST_LOGINS.md).
const loginCount = await createLogins({ reset: false });

await store.addAudit({
  actor: `import:${SOURCE}`,
  action: 'dataset_imported',
  target: SOURCE,
  details: {
    universities: univById.size,
    students: students.length,
    certificates: certs.length,
    revokedOnChain: revoked,
    logins: loginCount,
  },
});
await store.close();
console.log('Done.');

/** Creates the test accounts and writes TEST_LOGINS.md:
 *  1 platform admin (no university), 5 university registrars (Alliance University
 *  is one of them, like any other university) and 15 students.
 *  Without reset, an account keeps the password listed in TEST_LOGINS.md as long
 *  as it still matches the database; only new or mismatched accounts get one. */
async function createLogins({ reset }) {
  console.log('Test logins');
  const loginFile = path.join(DATA, 'TEST_LOGINS.md');
  const known = new Map();
  if (!reset && fs.existsSync(loginFile)) {
    for (const line of fs.readFileSync(loginFile, 'utf8').split('\n')) {
      const cells = line.split('|').map((c) => c.trim());
      if (/^\d+$/.test(cells[1] ?? '')) known.set(cells[4], cells[5]);
    }
  }
  // Before the platform/university split, Alliance's registrar doubled as platform admin.
  await store.raw("DELETE FROM users WHERE username = 'registrar.admin' AND role = 'admin'");

  const newPassword = () => `Ka-${crypto.randomBytes(5).toString('hex')}`;
  async function ensureUser(user) {
    const existing = await store.getUser(user.username);
    const listed = known.get(user.username);
    if (existing && listed && (await verifyPassword(listed, existing.passwordHash))) return listed;
    const password = newPassword();
    const passwordHash = await hashPassword(password);
    if (existing) {
      await store.raw('UPDATE users SET password_hash = $2, failed_attempts = 0, locked_until = NULL WHERE username = $1', [
        user.username,
        passwordHash,
      ]);
    } else {
      await store.createUser({ ...user, passwordHash });
    }
    return password;
  }
  const logins = [];

  logins.push({
    kind: 'Platform admin',
    institution: 'Chain of Record platform (no university)',
    login: 'platform.admin',
    password: await ensureUser({ username: 'platform.admin', email: 'platform.admin@example.in', role: 'admin' }),
    detail: 'Approves / suspends universities, registry pause, audit log. Cannot see or issue credentials.',
  });

  const REGISTRAR_UNIVERSITIES = ['U02', 'U01', 'U05', 'U08', 'U12']; // Alliance, VTU, NITK, PES, Christ
  for (const univId of REGISTRAR_UNIVERSITIES) {
    const inst = univById.get(univId);
    const email = `registrar@${inst.shortCode.toLowerCase()}.example.in`;
    logins.push({
      kind: 'University admin',
      institution: inst.name,
      login: email,
      password: await ensureUser({ username: email, email, role: 'institution', institutionId: inst.id }),
      detail: 'Issues, revokes and views only this university\'s credentials.',
    });
  }

  // One student per university (15 universities), each holding an ISSUED degree.
  const studentById = new Map(students.map((s) => [s.student_id, s]));
  const picked = [];
  for (const univId of [...univById.keys()].filter((u) => u !== 'U07' && u !== 'U03')) {
    const d = certs.find((c) => c.univ_id === univId && c.certificate_status === 'ISSUED' && !c.revocation_reason);
    if (d) picked.push(d);
  }
  for (const d of picked.slice(0, 15)) {
    const s = studentById.get(d.student_id);
    const email = s.email.toLowerCase();
    logins.push({
      kind: 'Student',
      institution: univById.get(d.univ_id).name,
      login: email,
      password: await ensureUser({
        username: email,
        email,
        role: 'student',
        studentId: s.student_id,
        institutionId: instId(d.univ_id),
      }),
      detail: `${s.full_name} · ${d.degree_name} ${d.branch} · certificate ${certNo(d)}`,
    });
  }

  const md = [
    '# Test logins (synthetic Karnataka Degree Registry)',
    '',
    'Created by `npm run import:karnataka`. Test accounts only; git-ignored. New passwords: `LOGINS_ONLY=1 npm run import:karnataka`.',
    '',
    '| # | Role | Institution | Sign-in (email / username) | Password | Details |',
    '|---|---|---|---|---|---|',
    ...logins.map((l, i) => `| ${i + 1} | ${l.kind} | ${l.institution} | ${l.login} | ${l.password} | ${l.detail ?? ''} |`),
    '',
    'Platform admin and university admins sign in at /admin. Students sign in at /student.',
    '',
    '## MetaMask test wallets',
    '',
    'Every write is signed in MetaMask. Import the matching key (MetaMask > Add account > Import account),',
    'switch MetaMask to Sepolia, and use that account in the Credential Center. Test keys holding only Sepolia test ETH.',
    'The platform admin signs with the contract owner (deployer) account.',
    '',
    '| University | Address | Private key (test only) |',
    '|---|---|---|',
    ...[...univById].map(([univId, inst]) => `| ${inst.name} | ${inst.walletAddress} | ${walletKeys[univId]} |`),
    '',
  ].join('\n');
  fs.writeFileSync(loginFile, md);
  console.log(`  ${logins.length} accounts -> data/karnataka/TEST_LOGINS.md`);
  return logins.length;
}
