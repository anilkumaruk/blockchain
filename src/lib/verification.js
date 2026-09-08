// Pure, framework-free helpers for the "Credential DNA" verification
// experience. No blockchain or network call is involved — every check
// produced here reflects something this prototype actually computes.
// The mock API's SHA-256 pipeline (mockApi.js / generateCertificatePdf.js)
// is not touched or duplicated; this module only interprets its results.

export const VERIFICATION_STATES = {
  VERIFIED: 'verified',
  REVOKED: 'revoked',
  MISMATCH: 'mismatch',
  NOT_FOUND: 'not_found',
};

const STATE_META = {
  verified: {
    title: 'Credential Verified',
    summary: 'This credential matches the registered credential record and has not been revoked.',
  },
  revoked: {
    title: 'Credential Revoked',
    summary: 'This credential exists in the registry but is no longer valid.',
  },
  mismatch: {
    title: 'Document Altered',
    summary: 'The uploaded document does not match the registered credential fingerprint.',
  },
  not_found: {
    title: 'Credential Not Found',
    summary: 'No registered credential matches the information provided.',
  },
};

export function getStateMeta(state) {
  return STATE_META[state] || STATE_META.not_found;
}

/**
 * The mock API's verifyCredential() returns the same 'invalid' status for
 * two different situations — "no record for this ID" and "no record has
 * this file's hash" — and doesn't need to know which lookup method was
 * used to tell them apart. The query method (ID/QR vs. file upload) is
 * exactly what disambiguates the two, so it's passed in here rather than
 * inferred inside the mock API.
 */
export function resolveVerificationState(status, queryType) {
  if (status === 'valid') return VERIFICATION_STATES.VERIFIED;
  if (status === 'revoked') return VERIFICATION_STATES.REVOKED;
  return queryType === 'hash' ? VERIFICATION_STATES.MISMATCH : VERIFICATION_STATES.NOT_FOUND;
}

/**
 * Builds the "verification checks" checklist for a resolved state. Every
 * item is something the app genuinely checked — nothing is added purely
 * for visual effect, and nothing claims more than the underlying lookup
 * actually established.
 *
 * `hasReference` (mismatch only): true when the UI has a specific credential
 * record to compare the uploaded file against — in practice, the last
 * credential this browser session actually verified (see VerificationUI's
 * "verify original, then verify a tampered copy" flow). Without one, there
 * is no known record to claim was "found", so the checklist stays minimal
 * and honest rather than claiming a lookup that didn't happen.
 */
export function getVerificationChecks(state, queryType, { hasReference = false } = {}) {
  if (state === VERIFICATION_STATES.VERIFIED || state === VERIFICATION_STATES.REVOKED) {
    const revoked = state === VERIFICATION_STATES.REVOKED;
    return summarize([
      { label: 'Credential exists', passed: true },
      { label: 'Issuer verified', passed: true },
      {
        label: queryType === 'hash' ? 'Document fingerprint matches' : 'Credential DNA registered',
        passed: true,
      },
      {
        label: revoked ? 'Credential has been revoked' : 'Credential is active',
        passed: !revoked,
        tone: revoked ? 'warn' : undefined,
      },
    ]);
  }

  if (state === VERIFICATION_STATES.MISMATCH) {
    if (hasReference) {
      return summarize([
        { label: 'Credential record found', passed: true },
        { label: 'Issuer record found', passed: true },
        { label: 'Document fingerprint mismatch', passed: false },
      ]);
    }
    return summarize([
      { label: 'Document fingerprint computed', passed: true },
      { label: 'Fingerprint matches a registered credential', passed: false },
    ]);
  }

  // not_found
  return summarize([
    { label: 'Credential ID lookup performed', passed: true },
    { label: 'Matching credential record found', passed: false },
  ]);
}

function summarize(checks) {
  const normalized = checks.map((c) => ({ ...c, tone: c.tone || (c.passed ? 'pass' : 'fail') }));
  const passed = normalized.filter((c) => c.passed).length;
  return { checks: normalized, passed, total: normalized.length };
}

/**
 * Deterministically derives a small grid of intensity values (0..1) from a
 * hex hash string, purely for the "Credential DNA" visual pattern. This is
 * presentation only — a decorative encoding of real hash bytes — and never
 * substitutes for the actual hash, which is always shown in full alongside
 * it (via HashChip).
 */
export function hashToFingerprintCells(hash, gridSize = 6) {
  const hex = String(hash).replace(/^0x/, '');
  const cellCount = gridSize * gridSize;
  const cells = [];
  for (let i = 0; i < cellCount; i++) {
    const start = (i * 2) % Math.max(hex.length, 1);
    const byteHex = hex.slice(start, start + 2).padEnd(2, '0');
    const byte = parseInt(byteHex, 16);
    cells.push(Number.isNaN(byte) ? 0 : byte / 255);
  }
  return cells;
}
