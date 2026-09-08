// Frontend-only mock API for "Chain of Record".
// Everything here simulates network + blockchain latency with setTimeout.
// No real server, database, or chain connection is involved.
//
// One thing IS real: document hashing. Credential hashes are genuine
// SHA-256 digests (via Web Crypto) of the deterministically-generated
// certificate PDF bytes, so uploading a real downloaded certificate on the
// Verification screen produces a real hash match against this mock store.

import { buildCertificateBytes, computeSha256Hex } from './generateCertificatePdf';
import { REFERENCE_INSTITUTION } from './institution';

const HEX = '0123456789abcdef';

function randomHex(len) {
  let out = '';
  for (let i = 0; i < len; i++) out += HEX[Math.floor(Math.random() * 16)];
  return out;
}

// Exported so the Admin issuance UI can generate a candidate credential ID
// and ledger reference up front for its review-before-issuing step, then
// pass those same values through to issueCredential() below — guaranteeing
// the certificate bytes (and therefore the SHA-256 hash) shown in the
// preview are byte-for-byte identical to what actually gets issued.
export function fakeTxHash() {
  return '0x' + randomHex(64);
}

export function fakeCredentialId() {
  const year = new Date().getFullYear();
  return `COR-${year}-${randomHex(6).toUpperCase()}`;
}

function delay(min = 600, max = 1200) {
  const ms = min + Math.random() * (max - min);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const ISSUER_NAME = REFERENCE_INSTITUTION.name;

// ---- seed data (hashes are computed for real at first load, see ensureReady) ----

const seedCredentials = [
  {
    credentialId: 'COR-2023-9F3A1C',
    studentName: 'Ananya Sharma',
    studentId: 'RGIT21CS014',
    credentialType: 'B.Tech in Computer Science & Engineering',
    issueDate: '2023-06-15',
    status: 'valid',
    txHash: fakeTxHash(),
    issuer: ISSUER_NAME,
    revocation: null,
  },
  {
    credentialId: 'COR-2023-4B7E22',
    studentName: 'Rohan Verma',
    studentId: 'RGIT21CS027',
    credentialType: 'B.Tech in Computer Science & Engineering',
    issueDate: '2023-06-15',
    status: 'revoked',
    txHash: fakeTxHash(),
    issuer: ISSUER_NAME,
    revocation: {
      reason: 'Issued in error — duplicate record for merged student file.',
      date: '2023-09-02',
    },
  },
  {
    credentialId: 'COR-2022-1A88D0',
    studentName: 'Priya Nair',
    studentId: 'RGIT19CS002',
    credentialType: 'B.Tech in Electronics & Communication Engineering',
    issueDate: '2022-05-30',
    status: 'valid',
    txHash: fakeTxHash(),
    issuer: ISSUER_NAME,
    revocation: null,
  },
  {
    credentialId: 'COR-2023-77C3E9',
    studentName: 'Karthik Iyer',
    studentId: 'RGIT21CS014',
    credentialType: 'M.Tech in Data Science',
    issueDate: '2023-11-20',
    status: 'valid',
    txHash: fakeTxHash(),
    issuer: ISSUER_NAME,
    revocation: null,
  },
  {
    credentialId: 'COR-2021-C51F6A',
    studentName: 'Sneha Reddy',
    studentId: 'RGIT18CS041',
    credentialType: 'B.Tech in Computer Science & Engineering',
    issueDate: '2021-06-10',
    status: 'valid',
    txHash: fakeTxHash(),
    issuer: ISSUER_NAME,
    revocation: null,
  },
  {
    credentialId: 'COR-2022-E20B4D',
    studentName: 'Aditya Kulkarni',
    studentId: 'RGIT19CS009',
    credentialType: 'B.Tech in Information Technology',
    issueDate: '2022-06-18',
    status: 'revoked',
    txHash: fakeTxHash(),
    issuer: ISSUER_NAME,
    revocation: {
      reason: 'Academic integrity violation confirmed after appeal process.',
      date: '2024-01-11',
    },
  },
  {
    credentialId: 'COR-2020-88A5F1',
    studentName: 'Meera Joshi',
    studentId: 'RGIT17CS003',
    credentialType: 'B.Tech in Computer Science & Engineering',
    issueDate: '2020-06-22',
    status: 'valid',
    txHash: fakeTxHash(),
    issuer: ISSUER_NAME,
    revocation: null,
  },
  {
    credentialId: 'COR-2024-3D6C90',
    studentName: 'Vikram Singh',
    studentId: 'RGIT20CS033',
    credentialType: 'B.Tech in Computer Science & Engineering',
    issueDate: '2024-06-05',
    status: 'valid',
    txHash: fakeTxHash(),
    issuer: ISSUER_NAME,
    revocation: null,
  },
];

// Bumped from v2: the reference institution changed (Rajiv Gandhi Institute
// of Technology -> Alliance University). Since the issuer name is part of
// the hashed certificate content, any browser with an old cached store must
// reseed rather than keep serving stale records under the old institution
// (and their now-inapplicable hashes).
const STORAGE_KEY = 'cor-mock-credentials-v3';

// The "logged in" demo student — used by the Student Portal.
export const DEMO_STUDENT_ID = 'RGIT21CS014';

// ---- store init ---------------------------------------------------------

let store = [];
let readyPromise = null;

function loadCached() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // ignore corrupt / unavailable storage, fall back to seeding
  }
  return null;
}

function persist() {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // storage unavailable (e.g. private mode) — session state still works
  }
}

async function ensureReady() {
  if (readyPromise) return readyPromise;
  readyPromise = (async () => {
    const cached = loadCached();
    if (cached) {
      store = cached;
      return;
    }
    const seeded = [];
    for (const c of seedCredentials) {
      const bytes = buildCertificateBytes(c);
      const hash = await computeSha256Hex(bytes);
      seeded.push({ ...c, hash });
    }
    store = seeded;
    persist();
  })();
  return readyPromise;
}

// ---- API ---------------------------------------------------------------

/**
 * `credentialId` and `txHash` are optional overrides — when omitted (the
 * original behavior, used by every existing caller), fresh random values
 * are generated exactly as before. The Admin issuance review step passes
 * in the same values it already used to compute a preview hash, so the
 * confirmed record's hash matches that preview exactly rather than being
 * silently recomputed against a second, different random ID.
 */
export async function issueCredential({
  studentName,
  studentId,
  credentialType,
  issueDate,
  credentialId: providedCredentialId,
  txHash: providedTxHash,
}) {
  await ensureReady();

  // Step 1: simulate PDF generation
  await delay(500, 800);

  const txHash = providedTxHash || fakeTxHash();
  const credentialId = providedCredentialId || fakeCredentialId();
  const fields = {
    credentialId,
    studentName,
    studentId,
    credentialType,
    issueDate: issueDate || new Date().toISOString().slice(0, 10),
    issuer: ISSUER_NAME,
    txHash,
  };

  // Step 2: real SHA-256 of the deterministically-generated certificate bytes
  const bytes = buildCertificateBytes(fields);
  const hash = await computeSha256Hex(bytes);

  // Step 3: simulate smart-contract transaction submission + confirmation
  await delay(700, 1200);

  const record = { ...fields, status: 'valid', hash, revocation: null };
  store = [record, ...store];
  persist();

  return {
    credentialId,
    hash,
    txHash,
    qrPayload: credentialId,
    record: { ...record },
  };
}

export async function getCredentialsForStudent(studentId) {
  await ensureReady();
  await delay();
  return store.filter((c) => c.studentId === studentId).map((c) => ({ ...c }));
}

export async function getAllCredentials() {
  await ensureReady();
  await delay();
  return store.map((c) => ({ ...c }));
}

export async function revokeCredential(credentialId, reason) {
  await ensureReady();
  await delay(700, 1100);
  const idx = store.findIndex((c) => c.credentialId === credentialId);
  if (idx === -1) throw new Error('Credential not found');
  const updated = {
    ...store[idx],
    status: 'revoked',
    revocation: {
      reason: reason?.trim() || 'No reason provided.',
      date: new Date().toISOString().slice(0, 10),
    },
  };
  store = [...store.slice(0, idx), updated, ...store.slice(idx + 1)];
  persist();
  return { ...updated };
}

/**
 * Verify a credential either by ID or by a client-computed file hash.
 * Mimics comparing a locally-recomputed SHA-256 against the on-chain record.
 */
export async function verifyCredential({ credentialId, fileHash }) {
  await ensureReady();
  await delay(700, 1300);

  let match = null;

  if (credentialId) {
    match = store.find(
      (c) => c.credentialId.toLowerCase() === credentialId.trim().toLowerCase()
    );
  } else if (fileHash) {
    match = store.find((c) => c.hash.toLowerCase() === fileHash.toLowerCase());
  }

  if (!match) {
    return {
      status: 'invalid',
      details: {
        reason: credentialId
          ? `No credential found on-chain matching ID "${credentialId}".`
          : 'The computed document hash does not match any record on-chain. The file may have been altered, or was never issued through this system.',
        submittedId: credentialId || null,
        submittedHash: fileHash || null,
      },
    };
  }

  if (match.status === 'revoked') {
    return {
      status: 'revoked',
      details: { ...match },
    };
  }

  return {
    status: 'valid',
    details: { ...match },
  };
}

export async function getCredentialById(credentialId) {
  await ensureReady();
  await delay(300, 500);
  const match = store.find(
    (c) => c.credentialId.toLowerCase() === credentialId.trim().toLowerCase()
  );
  return match ? { ...match } : null;
}
