// Real backend client for "Chain of Record" (see backend/server/app.js).
// Same exported functions and response shapes as mockApi.js, so pages don't
// care which one they're talking to — src/lib/api.js picks between them.

import { reasonHash, sendTransaction } from './wallet';

export { fakeCredentialId, fakeTxHash, DEMO_STUDENT_ID } from './mockApi';

const BASE_URL = String(import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
const TOKEN_KEY = 'cor-api-token';
const SESSION_KEY = 'cor-api-session';

let token = null;
let session = null;
try {
  token = window.sessionStorage.getItem(TOKEN_KEY);
  session = JSON.parse(window.sessionStorage.getItem(SESSION_KEY) || 'null');
} catch {
  // storage unavailable — the user just signs in again
}

export function hasSession() {
  return Boolean(token);
}

/** { role, sub, email, studentId, institution: { id, name } } or null */
export function getSession() {
  return token ? session : null;
}

async function http(path, { method = 'GET', body, auth = false, raw } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = raw ? 'application/pdf' : 'application/json';
  if (auth && token) headers.Authorization = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(`${BASE_URL}/api${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
    });
  } catch {
    throw new Error('Cannot reach the Chain of Record server.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.code = data.code;
    throw err;
  }
  return data;
}

/** Signs in with a username or email; `roles` limits which account types this screen accepts. */
export async function login(username, password, roles = ['admin', 'institution']) {
  const result = await http('/auth/login', { method: 'POST', body: { username, password } });
  if (!roles.includes(result.role)) {
    throw new Error(
      result.role === 'student'
        ? 'This is a student account. Sign in from the Student portal.'
        : 'This account cannot sign in here. Use the Credential Center.'
    );
  }
  const { token: newToken, ...rest } = result;
  token = newToken;
  session = rest;
  try {
    window.sessionStorage.setItem(TOKEN_KEY, token);
    window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    // ignore
  }
  return session;
}

/**
 * Issue: the server prepares the document hash, the registrar signs
 * issueCredential in MetaMask, and the server records it once the contract
 * shows it. `onStep` reports progress for the UI.
 */
export async function issueCredential(fields, onStep = () => {}) {
  onStep('Preparing the document hash');
  const prep = await http('/credentials/prepare', { method: 'POST', body: fields, auth: true });
  let txHash = null;
  if (!prep.alreadyOnChain) {
    onStep('Confirm the transaction in MetaMask');
    const { receipt } = await sendTransaction('issueCredential', [prep.credentialId, prep.docHash], prep.issuerAddress);
    txHash = receipt.hash;
  }
  onStep('Recording it');
  return http('/credentials', {
    method: 'POST',
    body: { ...prep.fields, studentEmail: fields.studentEmail, replaces: fields.replaces, txHash },
    auth: true,
  });
}

export function getCredentialsForStudent(studentId) {
  return http(`/students/${encodeURIComponent(studentId)}/credentials`);
}

// Admin-only on the server. Public pages (e.g. the verifier's quick-demo
// samples) call this too; without a session they simply get no samples.
export async function getAllCredentials() {
  if (!token) return [];
  return http('/credentials', { auth: true });
}

/** Revoke: signed in MetaMask by the issuing university, then recorded. */
export async function revokeCredential(credentialId, reason) {
  const record = await http(`/credentials/${encodeURIComponent(credentialId)}`);
  const why = reasonHash(reason);
  await (record.batch
    ? sendTransaction('revokeBatchCredential', [record.batch.batchId, credentialId, record.hash, record.batch.proof, why], record.issuerAddress)
    : sendTransaction('revokeCredential', [credentialId, why], record.issuerAddress));
  return http(`/credentials/${encodeURIComponent(credentialId)}/revoke`, { method: 'POST', body: { reason }, auth: true });
}

export function verifyCredential({ credentialId, fileHash }) {
  if (credentialId) return http(`/verify/${encodeURIComponent(credentialId.trim())}`);
  return http('/verify/hash', { method: 'POST', body: { hash: fileHash } });
}

export async function getCredentialById(credentialId) {
  try {
    return await http(`/credentials/${encodeURIComponent(credentialId.trim())}`);
  } catch (err) {
    if (err.status === 404) return null;
    throw err;
  }
}

export function logout() {
  token = null;
  session = null;
  try {
    window.sessionStorage.removeItem(TOKEN_KEY);
    window.sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // ignore
  }
}

export const verifyPhoto = (evidence) => http('/verify/photo', { method: 'POST', body: evidence });
export const getMyCertificates = () => http('/me/certificates', { auth: true });
export const getCertificateForIssuer = (id) => http(`/credentials/${encodeURIComponent(id)}/certificate`, { auth: true });

export function registerStudent(email, password) {
  return http('/auth/register/student', { method: 'POST', body: { email, password } });
}

export function registerInstitution(details) {
  return http('/institutions/register', { method: 'POST', body: details });
}

export function getMyCredentials() {
  return http('/me/credentials', { auth: true });
}

export function listInstitutionsAdmin() {
  return http('/admin/institutions', { auth: true });
}

/** Approve / suspend: the platform admin signs setIssuer in MetaMask (as the contract owner). */
export async function setInstitutionStatus(id, action) {
  if (action === 'approve' || action === 'suspend') {
    const inst = (await listInstitutionsAdmin()).find((i) => i.id === id);
    if (!inst?.walletAddress) throw new Error('This institution has no wallet address.');
    const { owner } = await getRegistryStatus();
    await sendTransaction('setIssuer', [inst.walletAddress, inst.name, action === 'approve'], owner);
  }
  return http(`/admin/institutions/${encodeURIComponent(id)}/${action}`, { method: 'POST', auth: true });
}

/** Merkle batch: one root signed once in MetaMask covers the whole list. */
export async function issueBatch(credentials) {
  const prep = await http('/credentials/batch/prepare', { method: 'POST', body: { credentials }, auth: true });
  const issuer = session?.institution?.walletAddress ?? (await http('/me', { auth: true })).institution?.walletAddress;
  const { receipt, contract } = await sendTransaction('anchorBatch', [prep.root, prep.count], issuer);
  const event = receipt.logs.map((l) => { try { return contract.interface.parseLog(l); } catch { return null; } }).find((e) => e?.name === 'BatchAnchored');
  return http('/credentials/batch', {
    method: 'POST',
    body: { credentials: prep.credentials, batchId: Number(event.args.batchId), txHash: receipt.hash },
    auth: true,
  });
}

export function getCredentialHistory(credentialId) {
  return http(`/credentials/${encodeURIComponent(credentialId)}/history`);
}

export function getAuditLog(limit = 50) {
  return http(`/admin/audit?limit=${limit}`, { auth: true });
}

export function getRegistryStatus() {
  return http('/admin/registry', { auth: true });
}

/** Emergency pause: signed by the contract owner in MetaMask, then recorded. */
export async function setRegistryPaused(paused) {
  const { owner } = await getRegistryStatus();
  await sendTransaction(paused ? 'pause' : 'unpause', [], owner);
  return http('/admin/pause', { method: 'POST', body: { paused }, auth: true });
}
