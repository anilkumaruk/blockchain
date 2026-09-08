// Pure logic for interpreting a decoded QR string against the app's two
// existing QR formats (see ShareProfileModal.jsx and StudentPortal.jsx):
//   1. A Verified Professional Passport profile URL — ".../profile/:studentId"
//   2. A raw credential ID — "COR-YYYY-XXXXXX" (see mockApi.js's fakeCredentialId)
// Nothing here talks to the camera or the DOM — it only decides what a
// decoded string means, so a QR result is never blindly navigated to.

const CREDENTIAL_ID_PATTERN = /^COR-\d{4}-[0-9A-F]{6}$/i;

/**
 * @param {string} text - raw decoded QR payload
 * @returns {{ type: 'profile', studentId: string } | { type: 'credential', credentialId: string } | null}
 *   null means the QR is not a recognized Chain of Record format.
 */
export function parseChainOfRecordQr(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return null;

  // Try as a URL (absolute or relative to this app's own origin). A QR
  // pointing at a different origin is never followed.
  try {
    const origin = typeof window !== 'undefined' ? window.location.origin : undefined;
    const url = new URL(trimmed, origin);
    if (origin && url.origin !== origin) return null;
    const profileMatch = url.pathname.match(/^\/profile\/([^/?#]+)/);
    if (profileMatch) {
      return { type: 'profile', studentId: decodeURIComponent(profileMatch[1]) };
    }
  } catch {
    // Not URL-shaped at all — fall through to the raw credential ID check.
  }

  if (CREDENTIAL_ID_PATTERN.test(trimmed)) {
    return { type: 'credential', credentialId: trimmed.toUpperCase() };
  }

  return null;
}
