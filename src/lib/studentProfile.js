// Derives an "Academic Passport" profile view from the existing credential
// records — no new fields are invented. Everything here is computed from
// data already present in mockApi.js records, so this stays a thin view
// layer that keeps working unchanged once mockApi.js is replaced by a real
// backend (same shape in, same shape out).

/**
 * @param {string} studentId
 * @param {Array} credentials - records for this student, as returned by
 *   getCredentialsForStudent (mock-store order: newly admin-issued
 *   credentials are unshifted to the front, so index 0 is the same
 *   "current" record the original Student Portal used for its heading).
 */
export function buildStudentProfile(studentId, credentials) {
  const byIssueDateAsc = [...credentials].sort(
    (a, b) => new Date(a.issueDate) - new Date(b.issueDate)
  );
  const byIssueDateDesc = [...byIssueDateAsc].reverse();

  // Identity fields are read from the same "representative" record the
  // original portal used (credentials[0]), not a date-sort — the seed data
  // has more than one differently-named student sharing the demo student ID,
  // and re-deriving "most recent" by date would silently swap the displayed
  // identity to a different person than before.
  const representative = credentials[0] || null;

  const institutions = [...new Set(credentials.map((c) => c.issuer))];

  const total = credentials.length;
  const active = credentials.filter((c) => c.status === 'valid').length;
  const revoked = credentials.filter((c) => c.status === 'revoked').length;

  return {
    studentId,
    studentName: representative?.studentName || null,
    // No separate "program" field exists on a credential — the
    // representative credential's type is used as the headline program,
    // the closest honest proxy available in the current data model.
    primaryProgram: representative?.credentialType || null,
    primaryInstitution: representative?.issuer || null,
    // Derived from the representative credential's issue year — not a
    // separate stored field, so it's presented as such in the UI.
    latestIssueYear: representative ? new Date(representative.issueDate).getFullYear() : null,
    allVerified: total > 0 && revoked === 0,
    stats: {
      total,
      active,
      revoked,
      institutions: institutions.length,
    },
    credentialsAsc: byIssueDateAsc,
    credentialsDesc: byIssueDateDesc,
  };
}

/** Groups credentials by issue year, most recent year first. */
export function groupCredentialsByYear(credentials) {
  const byYear = new Map();
  for (const c of credentials) {
    const year = new Date(c.issueDate).getFullYear();
    if (!byYear.has(year)) byYear.set(year, []);
    byYear.get(year).push(c);
  }
  return [...byYear.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([year, items]) => [
      year,
      [...items].sort((a, b) => new Date(b.issueDate) - new Date(a.issueDate)),
    ]);
}

export function buildProfileUrl(studentId) {
  return `${window.location.origin}/profile/${encodeURIComponent(studentId)}`;
}

/** Two-letter avatar initials from a display name. */
export function getInitials(name) {
  return (name || '?')
    .split(' ')
    .filter(Boolean)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

/**
 * The profile-level verification state — distinct from any individual
 * credential's state, and never a "student quality" score. Four outcomes:
 * 'empty' (no credentials at all), 'none' (every credential is revoked),
 * 'attention' (some but not all revoked), or 'verified' (all active).
 */
export function getProfileVerificationState(stats) {
  if (stats.total === 0) return 'empty';
  if (stats.active === 0) return 'none';
  if (stats.revoked > 0) return 'attention';
  return 'verified';
}
