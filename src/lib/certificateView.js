// What is printed on a certificate, and the exact string that gets hashed.
// Shared by the server (issue + verify), the import and the browser (rendering).

const sha256Hex = async (text) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
};
export { sha256Hex };

const dateOnly = (v) => (v ? String(v).slice(0, 10) : null);

/** Registry record: rebuilt from the columns, so an edited column changes the hash. */
export function degreeCanonical(d) {
  const parts = String(d.canonical_string).split('|');
  parts[1] = d.reg_no;
  parts[2] = d.candidate_name;
  parts[3] = dateOnly(d.dob);
  parts[5] = Number(d.cgpa_or_percent).toFixed(2);
  parts[6] = String(d.year_of_passing);
  return parts.join('|');
}

/** Certificate issued from the Admin Console. */
export const issuedCanonical = (f) =>
  [f.credentialId, f.studentId, String(f.studentName).toUpperCase(), f.issueDate, f.credentialType, f.issuer].join('|');

export function viewFromDegree(d) {
  return {
    kind: 'degree',
    certificateNo: d.certificate_serial_no || d.provisional_cert_no,
    credentialId: d.credential_id,
    title: d.certificate_status === 'PROVISIONAL_ONLY' ? 'PROVISIONAL MARKS CARD' : 'MARKS CARD',
    program: d.degree_level === 'PG' ? 'Postgraduate' : 'Undergraduate',
    enrollmentId: d.enrollment_id,
    university: d.university,
    registerNo: d.reg_no,
    name: d.candidate_name,
    dob: dateOnly(d.dob),
    degree: d.degree_name,
    branch: d.branch,
    score: Number(d.cgpa_or_percent).toFixed(2),
    classAwarded: d.class_awarded,
    year: String(d.year_of_passing),
    dateOfIssue: dateOnly(d.date_of_issue) ?? dateOnly(d.provisional_issue_date),
    certificateStatus: d.certificate_status,
    canonical: degreeCanonical(d),
  };
}

export function viewFromCredential(r) {
  return {
    kind: 'issued',
    certificateNo: r.certificateNo ?? r.credentialId,
    credentialId: r.credentialId,
    title: 'CERTIFICATE',
    university: r.issuer,
    registerNo: r.studentId,
    name: String(r.studentName).toUpperCase(),
    dob: null,
    degree: r.credentialType,
    branch: null,
    score: null,
    classAwarded: null,
    year: dateOnly(r.issueDate)?.slice(0, 4) ?? null,
    dateOfIssue: dateOnly(r.issueDate),
    certificateStatus: r.status === 'revoked' ? 'REVOKED' : 'ISSUED',
    canonical: issuedCanonical(r),
  };
}

// One line per semester: the exact text whose hash goes on the chain (marksHash).
export const marksString = (rows) =>
  [...rows]
    .sort((a, b) => Number(a.semester) - Number(b.semester))
    .map((r) => [r.semester, r.credits_earned, Number(r.sgpa).toFixed(2), r.result, r.backlogs].join('|'))
    .join('\n');

export const qrPayload = (certificateNo, hash) => `COR1|${certificateNo}|${hash}`;

/** The QR holds a link any phone can open, carrying the number and fingerprint. */
export const verifyUrl = (origin, certificateNo, hash) =>
  `${origin}/verify?credentialId=${encodeURIComponent(certificateNo)}&h=${hash}`;

export function parseQrPayload(text) {
  const raw = String(text ?? '').trim();
  const m = /^COR1\|([^|]+)\|([0-9a-f]{64})$/i.exec(raw);
  if (m) return { certificateNo: m[1], hash: m[2].toLowerCase() };
  try {
    const url = new URL(raw);
    const certificateNo = url.searchParams.get('credentialId');
    const hash = url.searchParams.get('h');
    if (certificateNo && /^[0-9a-f]{64}$/i.test(hash ?? '')) return { certificateNo, hash: hash.toLowerCase() };
  } catch {
    // not a link
  }
  return null;
}
