// Imports the Karnataka Degree Registry (data/karnataka/*.json) into the
// database and anchors every degree certificate on-chain:
//   - each university becomes an approved institution with its own issuer wallet
//   - each university's certificates are anchored in one Merkle-batch transaction
//   - REVOKED / WITHHELD / CANCELLED_DUPLICATE_ISSUED certificates are then
//     revoked on-chain with the dataset's reason
//   - all academic tables (colleges, programs, students, enrollments,
//     semester results, NAD export, verification requests) are loaded
//   - 5 admin and 15 student test logins are created; their generated
//     passwords are written to data/karnataka/TEST_LOGINS.md (git-ignored)
//
//   npm run import:karnataka
//
// Resumable: if a run is interrupted (network, RPC, database), just run it
// again. Every phase skips what is already done - universities and wallets are
// reused, rows are inserted with ON CONFLICT DO NOTHING, universities whose
// certificates are already anchored are skipped, revoked certificates are not
// revoked twice, and existing test accounts get fresh passwords.
// For a clean start run `node scripts/reset-db.js --confirm` first.

import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Contract, JsonRpcProvider, Wallet } from 'ethers';
import { loadConfig } from '../server/config.js';
import { createChainBridge } from '../server/chain.js';
import { createPgStore } from '../server/store.js';
import { createInstitutionService } from '../server/institutions.js';
import { hashPassword, verifyPassword } from '../server/passwords.js';
import { buildMerkleTree, leafOf } from '../server/merkle.js';
import { slugify } from '../server/wallets.js';
import { buildCertificateBytes, computeSha256Hex } from '../../src/lib/generateCertificatePdf.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(here, '..', 'data', 'karnataka');
const SOURCE = 'karnataka-degree-registry';
const load = (name) => JSON.parse(fs.readFileSync(path.join(DATA, `${name}.json`), 'utf8'));

const { config, errors } = loadConfig();
if (errors.length || config.useMemoryStore) {
  console.error(errors.join('\n') || 'Set DATABASE_URL to import.');
  process.exit(1);
}

const deployment = JSON.parse(fs.readFileSync(path.join(here, '..', 'deployments', `${config.network}.json`), 'utf8'));
const provider = new JsonRpcProvider(config.rpcUrl, deployment.chainId, { staticNetwork: true, cacheTimeout: -1 });
// The local chain mines instantly; don't wait ethers' default 4 s between receipt checks.
if (config.network === 'localhost') provider.pollingInterval = 200;
const contract = new Contract(config.contractAddress || deployment.address, deployment.abi, new Wallet(config.issuerKey, provider));
const contractAddress = await contract.getAddress();
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

// ---- universities -> institutions (each with its own issuer wallet) ------
console.log('Universities');
const rootRow = await institutions.root();
const univById = new Map();
for (const u of load('universities')) {
  const attrs = {
    kind: 'university',
    website: null,
    source: SOURCE,
    sourceRef: u.univ_id,
    shortCode: u.short_code,
    univType: u.univ_type,
    regulator: u.regulator,
    city: u.city,
    state: u.state,
    pincode: u.pincode,
    establishedYear: u.established_year,
    gradingSystem: u.grading_system,
    aisheCode: u.aishe_code,
    ugcRecognised: yn(u.ugc_recognised),
  };
  let inst;
  const id = slugify(u.univ_name);
  if (id === rootRow.id) {
    inst = await store.updateInstitution(rootRow.id, attrs); // the platform owner itself
  } else {
    // Resumable: an interrupted run may already have created / approved it.
    if (!(await store.getInstitution(id))) {
      await store.createInstitution({ id, name: u.univ_name, status: 'pending', ...attrs });
    }
    const current = await store.getInstitution(id);
    inst = current.status === 'approved' ? current : await institutions.approve(id, `import:${SOURCE}`);
  }
  univById.set(u.univ_id, await store.getInstitution(inst.id));
  console.log(`  ${u.short_code.padEnd(8)} ${inst.walletAddress}  ${u.univ_name}`);
}
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

// ---- degree certificates -> on-chain credentials (one Merkle batch per university)
console.log('Degree certificates -> blockchain');
const credIdOf = (no) => no.replace(/\//g, '-');
const byCertNo = new Map(certs.map((d) => [certNo(d), d]));
const credentialOf = new Map(); // certificate_id -> credential record
let gasTotal = 0n;

for (const [univId, inst] of univById) {
  const mine = certs.filter((d) => d.univ_id === univId);
  if (!mine.length) continue;
  // Already anchored and recorded by an earlier run? insertMany is all-or-nothing.
  const done = await store.raw('SELECT * FROM credentials WHERE institution_id = $1', [inst.id]);
  if (done.rows.length === mine.length) {
    const byNo = new Map(done.rows.map((r) => [r.certificate_no, r]));
    for (const d of mine) {
      const r = byNo.get(certNo(d));
      credentialOf.set(d.certificate_id, {
        credentialId: r.credential_id,
        hash: r.doc_hash,
        batch: r.batch,
        issueDate: r.issue_date,
        status: r.status,
      });
    }
    console.log(`  ${inst.shortCode.padEnd(8)} already anchored (${mine.length}), skipped`);
    continue;
  }
  const fieldsList = mine.map((d) => ({
    credentialId: credIdOf(certNo(d)),
    studentName: d.candidate_name,
    studentId: d.student_id,
    credentialType:
      `${d.degree_name}${d.branch && d.branch !== d.degree_name ? ` in ${d.branch}` : ''}${
        d.certificate_status === 'PROVISIONAL_ONLY' ? ' (Provisional)' : ''
      }`.slice(0, 200),
    issueDate: isoDate(d.date_of_issue) ?? isoDate(d.provisional_issue_date),
    issuer: inst.name,
    txHash: '0x' + crypto.randomBytes(32).toString('hex'),
  }));
  const hashes = await Promise.all(fieldsList.map((f) => computeSha256Hex(buildCertificateBytes(f))));
  const tree = buildMerkleTree(fieldsList.map((f, i) => leafOf(f.credentialId, hashes[i])));
  const bridge = await institutions.bridgeFor(inst);
  const receipt = await bridge.anchorBatch(tree.root, fieldsList.length);
  gasTotal += BigInt(receipt.gasUsed);

  const records = fieldsList.map((f, i) => ({
    ...f,
    certificateNo: certNo(mine[i]),
    institutionId: inst.id,
    issuerAddress: inst.walletAddress,
    hash: hashes[i],
    status: 'valid',
    revocation: null,
    batch: { batchId: receipt.batchId, root: tree.root, proof: tree.proof(i), index: i },
    chain: {
      mode: 'batch',
      txHash: receipt.txHash,
      blockNumber: receipt.blockNumber,
      gasUsed: String(receipt.gasUsed),
      contract: contractAddress,
      source: SOURCE,
      sourceId: mine[i].certificate_id,
    },
  }));
  await store.insertMany(records);
  records.forEach((r, i) => credentialOf.set(mine[i].certificate_id, r));
  console.log(`  ${univById.get(univId).shortCode.padEnd(8)} batch #${receipt.batchId}: ${records.length} certificates, gas ${receipt.gasUsed}`);
}

// Revoke what the registry says is not valid, with the registry's reason.
let revoked = 0;
for (const d of certs.filter((c) => ['REVOKED', 'WITHHELD', 'CANCELLED_DUPLICATE_ISSUED'].includes(c.certificate_status))) {
  const rec = credentialOf.get(d.certificate_id);
  if (rec.status === 'revoked') continue; // done in an earlier run
  const inst = univById.get(d.univ_id);
  const reason = d.certificate_status === 'WITHHELD' ? `Withheld: ${d.revocation_reason}` : d.revocation_reason;
  let receipt;
  try {
    receipt = await (await institutions.bridgeFor(inst)).revokeBatch(
      { ...rec.batch, credentialId: rec.credentialId, hash: rec.hash },
      reason
    );
  } catch (err) {
    // An interrupted run may have revoked it on-chain without recording it.
    if (err.reason !== 'AlreadyRevoked') throw err;
    receipt = { txHash: null, blockNumber: null, gasUsed: 0n };
  }
  gasTotal += BigInt(receipt.gasUsed);
  const patch = {
    status: 'revoked',
    revocation: { reason, date: rec.issueDate, txHash: receipt.txHash, blockNumber: receipt.blockNumber, gasUsed: String(receipt.gasUsed) },
  };
  const superseded = /^Superseded by (\S+)/.exec(d.revocation_reason || '');
  if (superseded && byCertNo.has(superseded[1])) patch.replacedBy = credIdOf(superseded[1]);
  await store.update(rec.credentialId, patch);
  revoked++;
}
// Duplicates issued for lost originals point back to the cancelled original.
for (const d of certs) {
  const dup = /^Duplicate of (\S+)/.exec(d.revocation_reason || '');
  if (dup && byCertNo.has(dup[1])) await store.update(credentialOf.get(d.certificate_id).credentialId, { replaces: credIdOf(dup[1]) });
}
console.log(`  revoked on-chain: ${revoked}; total gas ${gasTotal}`);

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
    gas: String(gasTotal),
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
  ].join('\n');
  fs.writeFileSync(loginFile, md);
  console.log(`  ${logins.length} accounts -> data/karnataka/TEST_LOGINS.md`);
  return logins.length;
}
