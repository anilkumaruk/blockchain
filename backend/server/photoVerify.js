// Certificate photo -> valid / invalid / revoked.
//
// A photo can never hash to the same value twice (every shot has different
// pixels), so the fingerprint is taken over the certificate's *data*, not its
// file. Steps:
//   1. Read the certificate number (QR code, else the OCR text).
//   2. Read the CredentialRegistry smart contract on Ethereum: the credential
//      (or its Merkle-batch membership), its status and the transaction's block.
//      Not there -> invalid.
//   3. Is the issuer an authorised, active university? No -> invalid.
//   4. Compare each printed field with the university's record. Different -> invalid.
//   5. Hash the record's canonical string and semester marks; the result must
//      equal the docHash in the contract. A QR code's hash must match too. Different -> invalid.
//   6. Revoked in the contract -> revoked. Otherwise -> valid.
// OCR misreads letters, so names allow small differences; numbers do not.

import { degreeCanonical, parseQrPayload, viewFromCredential, viewFromDegree } from '../../src/lib/certificateView.js';
import { documentHash } from './hash.js';

const SERIAL = /\b([A-Za-z]{2,10})\s*\/\s*(P?D?DC|PDC|DC)\s*\/\s*([0-9OoIlSB]{4})\s*\/\s*([0-9OoIlSB]{6})\b/;
const COR_ID = /\b(COR-\d{4}-[A-Za-z0-9]{4,12})\b/i;

const fixDigits = (s) => s.replace(/[Oo]/g, '0').replace(/[Il|]/g, '1').replace(/S/g, '5').replace(/B/g, '8');
// Characters OCR confuses, folded together, for register numbers.
const foldAlnum = (s) =>
  String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/[OQ]/g, '0').replace(/[IL]/g, '1').replace(/S/g, '5').replace(/B/g, '8').replace(/Z/g, '2').replace(/T/g, '7').replace(/G/g, '6');
const letters = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

function similarity(a, b) {
  if (!a.length && !b.length) return 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return 1 - prev[b.length] / Math.max(a.length, b.length);
}

// Label wording on the card -> field. A photo line may hold two "Label: value"
// pairs side by side, so every label on a line is found, not just the first.
const LABELS = [
  ['certificateNo', 'certificate\\s*n[o0]\\b\\.?'],
  ['certificateNo', 'credential\\s*id'],
  ['university', 'university'],
  ['registerNo', 'regist(?:er|ration)\\s*n[o0]\\b\\.?'],
  ['name', 'student\\s*name'],
  ['name', 'name'],
  ['dob', 'date\\s*of\\s*birth'],
  ['degree', 'degree'],
  ['branch', 'branch'],
  ['score', 'cgpa[^:;]*'],
  ['classAwarded', 'overall\\s*result'],
  ['classAwarded', 'class'],
  ['year', 'year\\s*of\\s*pass\\w*'],
  ['dateOfIssue', 'date\\s*of\\s*issue'],
  ['credits', 'total\\s*credit\\s*points'],
  ['program', 'program'],
  ['medium', 'medium'],
  ['batch', 'batch'],
];
const LABEL_PATTERN = new RegExp(`(?:^|[^A-Za-z])(${LABELS.map(([, p]) => p).join('|')})\\s*[:;]`, 'gi');
const fieldForLabel = (label) => LABELS.find(([, p]) => new RegExp(`^${p}$`, 'i').test(label))?.[0];

// A wide gap ends a value: whatever follows is the next column, not this field.
function cleanValue(field, raw) {
  const value = raw.split(/\s{3,}/)[0].trim();
  const pick = (pattern) => pattern.exec(value)?.[0] ?? value;
  if (field === 'year') return pick(/[0-9OoIlSB]{4}/);
  if (field === 'dob') return pick(/\d{4}\D{1,2}\d{2}\D{1,2}\d{2}/);
  if (field === 'score') return pick(/\d{1,3}(?:[.,]\d{1,2})?/).replace(',', '.');
  return value;
}

/** Pulls "Label: value" pairs out of OCR text. */
export function parseCertificateText(text) {
  const fields = {};
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const found = [...line.matchAll(LABEL_PATTERN)];
    found.forEach((m, i) => {
      const value = line.slice(m.index + m[0].length, found[i + 1]?.index ?? line.length).trim();
      const field = fieldForLabel(m[1].trim());
      if (field && !fields[field]) fields[field] = cleanValue(field, value);
    });
  }
  return fields;
}

/** Rows of the semester table: "Sem 1  20  7.38  PASS  0  Verified". */
export function parseSemesterRows(text) {
  const rows = new Map();
  // Table cells are far apart, so any non-digits may separate them on one line.
  const pattern = /\bSem\w*\s*(\d{1,2})\b[^\d\n]{0,60}(\d{1,3})[^\d\n]{1,60}(\d{1,2}[.,]\d{1,2})\b/gi;
  for (const m of String(text ?? '').matchAll(pattern)) {
    const sem = Number(m[1]);
    const sgpa = Number(m[3].replace(',', '.'));
    const row = rows.get(sem) ?? { credits: Number(m[2]), sgpa, readings: [] };
    row.readings.push(sgpa);
    rows.set(sem, row);
  }
  return rows;
}

export function extractCertificateNo(text, parsed = parseCertificateText(text)) {
  for (const source of [parsed.certificateNo, text]) {
    if (!source) continue;
    const serial = SERIAL.exec(source);
    if (serial) return `${serial[1]}/${serial[2].toUpperCase()}/${fixDigits(serial[3])}/${fixDigits(serial[4])}`;
    const cor = COR_ID.exec(source);
    if (cor) return cor[1];
  }
  return parsed.certificateNo?.trim() || null;
}

const NUMERIC = (a, b) => {
  const x = Number(fixDigits(String(a ?? '').replace(/[^0-9.OoIlSB]/g, '')));
  return Number.isFinite(x) && String(a ?? '').trim() !== '' && x === Number(b);
};
const DIGITS = (a, b) => fixDigits(String(a ?? '')).replace(/\D/g, '') === String(b).replace(/\D/g, '');
const fuzzy = (threshold) => (a, b) => similarity(letters(a), letters(b)) >= threshold;
const CHECKS = [
  ['name', 'Name', fuzzy(0.9)],
  // One misread character allowed: every other field must still match.
  ['registerNo', 'Register number', (a, b) => similarity(foldAlnum(a), foldAlnum(b)) >= 1 - 1 / Math.max(foldAlnum(b).length, 1) - 1e-9],
  ['dob', 'Date of birth', DIGITS],
  ['university', 'University', fuzzy(0.85)],
  ['degree', 'Degree', fuzzy(0.8)],
  ['branch', 'Branch', fuzzy(0.85)],
  ['score', 'CGPA or percentage', NUMERIC],
  ['year', 'Year of passing', DIGITS],
];

/** Field-by-field result. Never returns the record's value, only match or not. */
export function compareFields(view, parsed) {
  return CHECKS.filter(([key]) => view[key] != null && view[key] !== '').map(([key, label, match]) => ({
    field: key,
    label,
    found: parsed[key] ?? null,
    match: parsed[key] != null && match(parsed[key], view[key]),
  }));
}

/**
 * OCR confuses I, l and 1, so "IISc/DC/..." may be read as "lISc/DC/...".
 * If a number is not found, try the closest known university code. Every field
 * is still compared afterwards, so this cannot make a forgery pass.
 */
export function prefixCandidates(number, knownPrefixes = []) {
  const m = /^([^/]+)(\/.+)$/.exec(number);
  if (!m) return [];
  const read = foldAlnum(m[1]);
  return knownPrefixes
    .map((prefix) => ({ prefix, score: similarity(read, foldAlnum(prefix)) }))
    .filter((c) => c.score >= 0.6 && c.prefix !== m[1])
    .sort((a, b) => b.score - a.score)
    .map((c) => `${c.prefix}${m[2]}`);
}

// If OCR lost a label but the value is plainly printed somewhere, it still counts.
// Only for values long and specific enough not to appear by chance.
function foundInText(value, text) {
  const v = letters(value);
  return v.length >= 5 && letters(text).includes(v);
}

const verdict = (result, code, reason, extra = {}) => ({ verdict: result, code, reason, fields: [], ...extra });

/**
 * @param {{ ocrText?: string, qrText?: string }} input
 * @param {{ findDegree: Function, findCredential: Function, issuerTrusted: Function,
 *           onChain: ({ degree, credential, number }) => Promise<object|null>, findMarks?: Function,
 *           knownPrefixes?: Function }} deps
 *        onChain answers from the smart contract: { docHash, status, issuer, revokedAt, proof }
 */
export async function verifyCertificateEvidence({ ocrText = '', qrText = '' }, deps) {
  const qr = parseQrPayload(qrText);
  const parsed = parseCertificateText(ocrText);
  let number = qr?.certificateNo ?? extractCertificateNo(ocrText, parsed);
  if (!number) {
    return verdict('invalid', 'unreadable', 'No certificate number could be read. Retake the photo with the whole certificate in focus, or this is not a certificate.', { parsed });
  }

  let degree = await deps.findDegree(number);
  let credential = degree ? null : await deps.findCredential(number);
  if (!degree && !credential && deps.knownPrefixes) {
    for (const candidate of prefixCandidates(number, await deps.knownPrefixes())) {
      degree = await deps.findDegree(candidate);
      if (degree) {
        number = candidate;
        break;
      }
    }
  }
  const onChain = await deps.onChain({ degree, credential, number });
  if (!onChain) {
    return verdict('invalid', 'not_on_chain', `Certificate "${number}" is not recorded on the blockchain.`, { certificateNo: number, parsed });
  }
  const base = { certificateNo: number, parsed, proof: onChain.proof ?? null };

  const issuer = await deps.issuerTrusted(onChain.issuer);
  if (!issuer) {
    return verdict('invalid', 'untrusted_issuer', 'The issuer of this record is not an authorised university.', base);
  }
  base.issuer = { name: issuer.name, address: onChain.issuer };
  if (!degree && !credential) {
    return verdict('invalid', 'record_missing', 'The university holds no record matching this blockchain entry.', base);
  }

  const view = degree ? viewFromDegree(degree) : viewFromCredential(credential);
  base.fields = compareFields(view, parsed).map((f) =>
    f.found == null && ['name', 'registerNo', 'university', 'branch', 'dob'].includes(f.field) && foundInText(view[f.field], ocrText)
      ? { ...f, found: view[f.field], match: true }
      : f
  );
  // Marks: if the photo shows a semester table, every row must be read and match.
  // An unreadable row is never treated as a pass, or blurring one would hide a forgery.
  const marks = degree ? await deps.findMarks?.(degree.enrollment_id) : null;
  const read = parseSemesterRows(ocrText);
  if (marks?.length && (read.size > 0 || /\bSem\s*\d/i.test(ocrText))) {
    // OCR sometimes garbles a row's "Sem N" label: also accept the value from any results line.
    const looseReadings = new Set(
      ocrText
        .split(/\r?\n/)
        .filter((line) => /PASS|FAIL|Verified/i.test(line))
        .flatMap((line) => [...line.matchAll(/\b\d{1,2}[.,]\d{2}\b/g)].map((m) => Number(m[0].replace(',', '.'))))
    );
    for (const row of marks) {
      const seen = read.get(Number(row.semester));
      // The photo is read twice; a misread in one pass is forgiven if the other agrees.
      const match = (seen?.readings ?? []).includes(Number(row.sgpa)) || looseReadings.has(Number(row.sgpa));
      base.fields.push({
        field: `sem${row.semester}`,
        label: `Semester ${row.semester} SGPA`,
        found: match ? Number(row.sgpa).toFixed(2) : (seen?.sgpa.toFixed(2) ?? null),
        match,
      });
    }
  }
  const changed = base.fields.filter((f) => !f.match && f.found != null);
  const unread = base.fields.filter((f) => f.found == null);

  // Mismatched fields are always a red flag — a changed value is unambiguously wrong
  if (changed.length) {
    return { verdict: 'invalid', code: 'field_mismatch', reason: `These details do not match the university's record: ${changed.map((f) => f.label).join(', ')}.`, ...base };
  }

  // Cryptographic hash check — the strongest form of verification
  const recomputed = documentHash(degree ? degreeCanonical(degree) : view.canonical, marks ?? []);
  base.hash = { recomputed, onChain: onChain.docHash, match: recomputed === onChain.docHash };

  if (unread.length) {
    if (!base.hash.match) {
      // Hash mismatch AND unreadable fields → data was definitely altered
      return { verdict: 'invalid', code: 'hash_mismatch', reason: "The university's record or marks no longer hash to the docHash in the smart contract: the record was altered.", ...base };
    }
    // Hash matches: DB data is cryptographically verified against the blockchain.
    // Unreadable SEMESTER rows are still a red flag — the photo might be hiding edited marks.
    const unreadSems = unread.filter((f) => f.field.startsWith('sem'));
    if (unreadSems.length) {
      return { verdict: 'invalid', code: 'fields_unreadable', reason: `Could not read: ${unreadSems.map((f) => f.label).join(', ')}. Retake the photo with the semester table visible and in focus.`, ...base };
    }
    // Only unreadable header fields (name, date, etc.) AND hash matches → continue to valid
    // The cryptographic proof is sufficient; minor OCR failures on decorative text are acceptable.
  }

  if (!base.hash.match) {
    return { verdict: 'invalid', code: 'hash_mismatch', reason: "The university's record or marks no longer hash to the docHash in the smart contract: the record was altered.", ...base };
  }
  if (qr && `0x${qr.hash}` !== onChain.docHash) {
    return { verdict: 'invalid', code: 'qr_hash_mismatch', reason: "The QR code's hash does not match the blockchain.", ...base };
  }

  if (onChain.status === 'revoked') {
    const why = degree?.revocation_reason ?? credential?.revocation?.reason ?? null;
    return { verdict: 'revoked', code: 'revoked', reason: why ? `Revoked by the university: ${why}` : 'Revoked by the university.', revokedAt: onChain.revokedAt, ...base };
  }
  const provisional = degree?.certificate_status === 'PROVISIONAL_ONLY';
  return {
    verdict: 'valid',
    code: provisional ? 'valid_provisional' : 'valid',
    reason: provisional ? 'Genuine provisional certificate; the degree has not yet been conferred.' : 'Genuine: every detail matches and the hash is on the blockchain.',
    ...base,
  };
}
