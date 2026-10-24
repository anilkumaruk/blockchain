// Real backend client for "Chain of Record" (see backend/server/app.js).
// Same exported functions and response shapes as mockApi.js, so pages don't
// care which one they're talking to — src/lib/api.js picks between them.

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

export function issueCredential(fields) {
  return http('/credentials', { method: 'POST', body: fields, auth: true });
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

export function revokeCredential(credentialId, reason) {
  return http(`/credentials/${encodeURIComponent(credentialId)}/revoke`, {
    method: 'POST',
    body: { reason },
    auth: true,
  });
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

export function setInstitutionStatus(id, action) {
  return http(`/admin/institutions/${encodeURIComponent(id)}/${action}`, { method: 'POST', auth: true });
}

export function issueBatch(credentials) {
  return http('/credentials/batch', { method: 'POST', body: { credentials }, auth: true });
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

export function setRegistryPaused(paused) {
  return http('/admin/pause', { method: 'POST', body: { paused }, auth: true });
}
