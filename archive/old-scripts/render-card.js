// Renders one sample marks card to a PNG, to review the design.
//   node scripts/render-card.js <certificate number> <out.png>

import sharp from 'sharp';
import { loadData } from './lib/dataset-ledger.js';
import { certificateSvg } from '../../src/lib/certificateSvg.js';
import { viewFromDegree } from '../../src/lib/certificateView.js';

const [no, out] = process.argv.slice(2);
const d = loadData('degree_certificates').find((c) => (c.certificate_serial_no || c.provisional_cert_no) === no);
const uni = loadData('universities').find((u) => u.univ_id === d.univ_id).univ_name;
const e = loadData('enrollments').find((x) => x.enrollment_id === d.enrollment_id);
const view = {
  ...viewFromDegree({ ...d, university: uni }),
  semesters: loadData('semester_results').filter((s) => s.enrollment_id === d.enrollment_id),
  batch: e.academic_session,
  medium: e.medium,
};
const svg = certificateSvg(
  { view, hash: d.sha256_hash, txId: 'ab12cd34ef'.repeat(6) + 'abcd', status: d.certificate_status === 'REVOKED' ? 'revoked' : 'valid', marksVerified: true },
  { origin: 'https://blockchain-ecru-three.vercel.app' }
);
await sharp(Buffer.from(svg)).png().toFile(out);
console.log(out);
