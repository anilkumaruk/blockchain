// Picks the data source for the whole app:
//   - VITE_API_URL set   -> real backend (Express + Solidity registry via ethers.js)
//   - VITE_API_URL unset -> in-browser mock (the static Vercel demo)

import * as mock from './mockApi';
import * as backend from './httpApi';
import { REFERENCE_INSTITUTION } from './institution';

export const USE_BACKEND = Boolean(import.meta.env.VITE_API_URL);
const impl = USE_BACKEND ? backend : mock;

export const { fakeCredentialId, fakeTxHash, DEMO_STUDENT_ID } = mock;

export const issueCredential = (...args) => impl.issueCredential(...args);
export const getCredentialsForStudent = (...args) => impl.getCredentialsForStudent(...args);
export const getAllCredentials = (...args) => impl.getAllCredentials(...args);
export const revokeCredential = (...args) => impl.revokeCredential(...args);
export const verifyCredential = (...args) => impl.verifyCredential(...args);
export const getCredentialById = (...args) => impl.getCredentialById(...args);

// Mock login accepts anything non-empty; the backend checks credentials and
// issues a JWT that the admin-only endpoints require.
export async function adminLogin(username, password) {
  if (USE_BACKEND) return backend.login(username, password, ['admin', 'institution']);
  await new Promise((resolve) => setTimeout(resolve, 550));
  return { role: 'admin' };
}

export function studentLogin(email, password) {
  return backend.login(email, password, ['student']);
}

export function getSession() {
  return USE_BACKEND ? backend.getSession() : null;
}

/** The institution the signed-in registrar issues for (the reference institution in mock mode). */
export function currentInstitution() {
  return getSession()?.institution ?? REFERENCE_INSTITUTION;
}

export function signOut() {
  if (USE_BACKEND) backend.logout();
}
export const adminLogout = signOut;

// Backend-only features (Merkle batches, on-chain history, audit log,
// emergency pause). The UI only shows them when USE_BACKEND is true.
export const {
  issueBatch,
  getCredentialHistory,
  getAuditLog,
  getRegistryStatus,
  setRegistryPaused,
  registerStudent,
  registerInstitution,
  getMyCredentials,
  listInstitutionsAdmin,
  setInstitutionStatus,
} = backend;
