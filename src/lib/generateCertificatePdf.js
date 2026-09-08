// Generates a minimal, valid PDF client-side (no library) as a placeholder
// certificate. Building is deterministic given the same credential fields,
// so the SHA-256 computed once at issuance time will always match the
// SHA-256 recomputed from a downloaded copy — that's what lets the
// Verification screen's "Upload Certificate" flow work for real using the
// actual Web Crypto API, against a mock on-chain record.

function escapePdfText(str) {
  return String(str).replace(/[\\()]/g, (c) => `\\${c}`);
}

function buildContentStream(lines) {
  const ops = [];
  let y = 700;
  for (const { text, size = 12, gap = 22, color } of lines) {
    if (color) ops.push(`${color[0]} ${color[1]} ${color[2]} rg`);
    else ops.push('0.11 0.17 0.18 rg');
    ops.push(`BT /F1 ${size} Tf 72 ${y} Td (${escapePdfText(text)}) Tj ET`);
    y -= gap;
  }
  return ops.join('\n');
}

/**
 * Builds the certificate PDF bytes for a credential. Deliberately excludes
 * the document hash itself (that would be circular) — only fields known
 * before hashing are embedded.
 */
export function buildCertificateBytes(fields) {
  const { studentName, studentId, credentialType, issuer, issueDate, credentialId, txHash } =
    fields;

  const lines = [
    { text: 'Certificate of Completion', size: 22, gap: 34 },
    { text: '(Chain of Record - simulated academic credential)', size: 10, gap: 30, color: [0.34, 0.41, 0.44] },
    { text: 'This certifies that', size: 12, gap: 26 },
    { text: studentName, size: 18, gap: 30, color: [0.18, 0.33, 0.41] },
    { text: `Student ID: ${studentId}`, size: 11, gap: 22 },
    { text: 'has been awarded the credential:', size: 12, gap: 24 },
    { text: credentialType, size: 14, gap: 30 },
    { text: `Issued by: ${issuer}`, size: 11, gap: 20 },
    { text: `Issue date: ${issueDate}`, size: 11, gap: 26 },
    { text: `Credential ID: ${credentialId}`, size: 10, gap: 18, color: [0.34, 0.41, 0.44] },
    { text: `Transaction ref: ${txHash}`, size: 8, gap: 24, color: [0.34, 0.41, 0.44] },
    {
      text: 'Verify this certificate by uploading this PDF at the Chain of Record',
      size: 9,
      gap: 14,
      color: [0.34, 0.41, 0.44],
    },
    {
      text: 'verification portal, or by scanning the QR code on the student portal.',
      size: 9,
      gap: 16,
      color: [0.34, 0.41, 0.44],
    },
  ];

  const content = buildContentStream(lines);
  const encoder = new TextEncoder();
  const contentBytes = encoder.encode(content);

  const objects = [];
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push('<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  objects.push(
    '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /MediaBox [0 0 612 792] /Contents 5 0 R >>'
  );
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  objects.push(`<< /Length ${contentBytes.length} >>\nstream\n${content}\nendstream`);

  let pdf = '%PDF-1.4\n';
  const offsets = [0];

  objects.forEach((body, i) => {
    offsets.push(encoder.encode(pdf).length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefStart = encoder.encode(pdf).length;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) {
    xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += xref;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

  return encoder.encode(pdf);
}

/** Real SHA-256 over arbitrary bytes, via the Web Crypto API. */
export async function computeSha256Hex(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return '0x' + hex;
}

export function downloadCertificatePdf(credential) {
  const bytes = buildCertificateBytes(credential);
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${credential.credentialId}-certificate.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/**
 * Builds a one-page "Verified Professional Passport" resume PDF summarizing
 * every credential on a student's profile, using the same hand-rolled PDF
 * writer as the certificate generator. Purely a client-side re-presentation
 * of data already in the mock store — no new facts (CGPA, skills, projects,
 * work experience, etc.) are introduced, since none of those exist in the
 * current credential data model.
 *
 * `profileUrl` is printed as plain text rather than a scannable QR code —
 * see the note on downloadVerifiedResumePdf() for why.
 */
export function buildResumeBytes(profile, credentials, profileUrl) {
  const lines = [
    { text: 'CHAIN OF RECORD', size: 9, gap: 16, color: [0.34, 0.41, 0.44] },
    { text: 'Verified Professional Passport', size: 19, gap: 32, color: [0.18, 0.33, 0.41] },
    { text: profile.studentName || 'Unknown student', size: 15, gap: 22 },
    { text: profile.primaryProgram || '', size: 11, gap: 18 },
    { text: profile.primaryInstitution || '', size: 10, gap: 18, color: [0.34, 0.41, 0.44] },
    { text: `Student ID: ${profile.studentId}`, size: 9, gap: 14, color: [0.34, 0.41, 0.44] },
  ];

  if (profile.latestIssueYear) {
    lines.push({
      text: `Class of ${profile.latestIssueYear}`,
      size: 9,
      gap: 26,
      color: [0.34, 0.41, 0.44],
    });
  } else {
    lines.push({ text: '', size: 9, gap: 14 });
  }

  lines.push({ text: 'VERIFIED ACADEMIC CREDENTIALS', size: 11, gap: 22 });

  for (const c of credentials) {
    lines.push({ text: c.credentialType, size: 10, gap: 14 });
    lines.push({
      text: `  ${c.issuer} — Issued: ${c.issueDate}`,
      size: 8,
      gap: 13,
      color: [0.34, 0.41, 0.44],
    });
    lines.push({
      text: `  Credential ID: ${c.credentialId} — Status: ${
        c.status === 'revoked' ? 'Revoked' : 'Verified'
      }`,
      size: 8,
      gap: 20,
      color: [0.34, 0.41, 0.44],
    });
  }

  lines.push({ text: 'VERIFICATION', size: 11, gap: 18 });
  lines.push({
    text: 'Credentials listed in this resume can be independently verified',
    size: 8,
    gap: 12,
    color: [0.34, 0.41, 0.44],
  });
  lines.push({
    text: 'through Chain of Record, using each Credential ID.',
    size: 8,
    gap: 22,
    color: [0.34, 0.41, 0.44],
  });

  if (profileUrl) {
    lines.push({
      text: 'Verified profile:',
      size: 8,
      gap: 12,
      color: [0.34, 0.41, 0.44],
    });
    lines.push({
      text: profileUrl,
      size: 8,
      gap: 16,
      color: [0.18, 0.33, 0.41],
    });
  }

  const content = buildContentStream(lines);
  const encoder = new TextEncoder();
  const contentBytes = encoder.encode(content);

  const objects = [];
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push('<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  objects.push(
    '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /MediaBox [0 0 612 792] /Contents 5 0 R >>'
  );
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  objects.push(`<< /Length ${contentBytes.length} >>\nstream\n${content}\nendstream`);

  let pdf = '%PDF-1.4\n';
  const offsets = [0];

  objects.forEach((body, i) => {
    offsets.push(encoder.encode(pdf).length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefStart = encoder.encode(pdf).length;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) {
    xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += xref;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

  return encoder.encode(pdf);
}

/**
 * `profileUrl` (from studentProfile.js's buildProfileUrl) is printed as
 * plain text on the resume rather than embedded as a scannable QR image.
 * This PDF writer only supports simple text drawing (see
 * buildContentStream) — it has no image/XObject or vector-fill support, and
 * qrcode.react (used everywhere else in the app) only exposes DOM-rendering
 * components, not a raw module matrix. Adding either would mean building a
 * real QR encoder or an image-embedding PDF writer from scratch — a genuine
 * rewrite of this generator, not a careful modification — so it's left as a
 * documented limitation rather than attempted. The on-screen Share modal
 * still provides a real, scannable QR for this same URL.
 */
export function downloadVerifiedResumePdf(profile, credentials, profileUrl) {
  const bytes = buildResumeBytes(profile, credentials, profileUrl);
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${profile.studentId}-verified-resume.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
