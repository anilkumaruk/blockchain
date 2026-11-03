// Renders certificates from the dataset, degrades them like phone photos,
// reads them with the same OCR and QR steps the website uses, and measures the
// verdicts. Writes results/photo-ocr.md and demo images to public/samples/.
//   npm run chain:photos            (BENCH_PER_CASE=8 by default)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import jsQR from 'jsqr';
import { createWorker } from 'tesseract.js';
import { buildDatasetChain, loadData } from './lib/dataset-chain.js';
import { verifyCertificateEvidence } from '../server/photoVerify.js';
import { certificateSvg } from '../../src/lib/certificateSvg.js';
import { viewFromDegree } from '../../src/lib/certificateView.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const PER_CASE = Number(process.env.BENCH_PER_CASE || 8);
const SAMPLES = path.join(root, '..', 'public', 'samples');
fs.mkdirSync(SAMPLES, { recursive: true });

const { deps, certs, semesters, enrollments, records } = await buildDatasetChain(console.log);
// What the marks card prints about the chain: the document hash in the contract and its status there.
const chainCard = async (d) => {
  const degree = records.get(certNo(d).toLowerCase());
  const onChain = await deps.onChain({ degree });
  return { hash: degree.record.hash.slice(2), txId: null, block: degree.record.blockNumber, status: onChain.status, marksVerified: true };
};
const ORIGIN = 'https://blockchain-ecru-three.vercel.app';
const universityOf = new Map(loadData('universities').map((u) => [u.univ_id, u.univ_name]));
const viewOf = (d) => {
  const view = viewFromDegree({ ...d, university: universityOf.get(d.univ_id) });
  const e = enrollments.get(d.enrollment_id);
  return { ...view, semesters: semesters.get(d.enrollment_id), batch: e?.academic_session, medium: e?.medium };
};
const of = (status, extra = () => true) => certs.filter((d) => d.certificate_status === status && extra(d));
const issued = of('ISSUED', (d) => !d.revocation_reason);
// Evenly spaced, so results are not from one university.
const certNo = (d) => d.certificate_serial_no || d.provisional_cert_no;
const pick = (list, n, offset = 0) => Array.from({ length: n }, (_, i) => list[(offset + Math.floor((i * list.length) / n)) % list.length]);

const CASES = [
  { key: 'genuine', want: 'valid', docs: pick(issued, PER_CASE), alter: (v) => v, sample: 'genuine-valid' },
  { key: 'revoked', want: 'revoked', docs: pick(of('REVOKED'), PER_CASE), alter: (v) => v, sample: 'revoked' },
  { key: 'cgpa edited', want: 'invalid', docs: pick(issued, PER_CASE, 3), alter: (v) => ({ ...v, score: (Math.min(Number(v.score) + 1.3, 99)).toFixed(2) }), sample: 'forged-cgpa' },
  { key: 'name edited', want: 'invalid', docs: pick(issued, PER_CASE, 7), alter: (v) => ({ ...v, name: 'ROHIT KUMAR SHARMA' }), sample: 'forged-name' },
  {
    key: 'sgpa edited',
    want: 'invalid',
    docs: pick(issued, PER_CASE, 5),
    alter: (v) => ({ ...v, semesters: v.semesters.map((s, i) => (i === 1 ? { ...s, sgpa: Math.min(Number(s.sgpa) + 1.1, 9.9) } : s)) }),
    sample: 'forged-marks',
  },
  { key: 'year edited', want: 'invalid', docs: pick(issued, PER_CASE, 11), alter: (v) => ({ ...v, year: String(Number(v.year) - 2) }) },
  { key: 'fake serial', want: 'invalid', docs: pick(issued, PER_CASE, 13), alter: (v) => ({ ...v, certificateNo: 'VTU/DC/2019/999999' }), noQr: true, sample: 'fake-serial' },
];

async function noiseLayer(width, height, amount) {
  const data = Buffer.alloc(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    const v = Math.random() < 0.5 ? 0 : 255;
    data[i] = data[i + 1] = data[i + 2] = v;
    data[i + 3] = Math.random() * amount;
  }
  return sharp(data, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

// Simulated phone-photo conditions (these are not real camera photos).
const CONDITIONS = {
  clean: (img) => img,
  'phone-like': async (img, i) => {
    const angle = [-2, 1.5, -1, 2][i % 4];
    const base = await img.rotate(angle, { background: '#d8d4cc' }).blur(0.7).modulate({ brightness: 0.9 }).png().toBuffer();
    const { width, height } = await sharp(base).metadata();
    const noisy = await sharp(base).composite([{ input: await noiseLayer(width, height, 28) }]).jpeg({ quality: 72 }).toBuffer();
    return sharp(noisy);
  },
  'poor (small, blurred)': async (img) => {
    const small = await img.resize(1000).blur(1).modulate({ brightness: 0.8 }).jpeg({ quality: 55 }).toBuffer();
    return sharp(small);
  },
};



const worker = await createWorker('eng', 1, { langPath: path.join(root, '..', 'public', 'tesseract'), cacheMethod: 'none', logger: () => {} });
await worker.setParameters({ preserve_interword_spaces: '1' });

async function read(buffer) {
  // The same steps as the website: enlarge small images, greyscale, stretch contrast.
  const { width } = await sharp(buffer).metadata();
  const prepared = await sharp(buffer).resize(Math.max(width, 2000)).greyscale().normalise().png().toBuffer();
  // Two passes, like the website: page layout for the fields, one text block for the table rows.
  await worker.setParameters({ tessedit_pageseg_mode: '3' });
  const { data: { text: page } } = await worker.recognize(prepared, { rotateAuto: true });
  await worker.setParameters({ tessedit_pageseg_mode: '6' });
  const { data: { text: block } } = await worker.recognize(prepared, { rotateAuto: true });
  await worker.setParameters({ tessedit_char_whitelist: 'Sem0123456789.PASFIL ' });
  const { data: { text: digits } } = await worker.recognize(prepared, { rotateAuto: true });
  await worker.setParameters({ tessedit_char_whitelist: '' });
  const text = `${page}\n${block}\n${digits}`;
  // A little smoothing helps the QR reader with grainy images.
  const { data, info } = await sharp(buffer).resize(Math.max(width, 2000)).median(3).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const qr = jsQR(new Uint8ClampedArray(data), info.width, info.height);
  return { ocrText: text, qrText: qr?.data ?? '' };
}

// Demo images for the website's sample buttons: a good photo (slight tilt, no
// blur or speckle). Each is checked with the same OCR steps as the website; a
// card whose rows this OCR misreads is skipped for the next one, and the number
// of skipped cards is printed. The benchmark below measures every card.
async function writeSamples() {
  for (const c of CASES.filter((x) => x.sample)) {
    const candidates = [...c.docs, ...pick(c.key === 'revoked' ? of('REVOKED') : issued, 12, 1)];
    for (const [tries, d] of candidates.entries()) {
      const svg = certificateSvg({ view: c.alter(viewOf(d)), ...(await chainCard(d)) }, { origin: ORIGIN, includeQr: !c.noQr });
      const out = await sharp(Buffer.from(svg)).flatten({ background: '#fff' }).rotate(-0.5, { background: '#d8d4cc' }).modulate({ brightness: 0.96 }).jpeg({ quality: 82 }).toBuffer();
      const verdict = (await verifyCertificateEvidence(await read(out), deps)).verdict;
      if (verdict !== c.want) continue;
      fs.writeFileSync(path.join(SAMPLES, `${c.sample}.jpg`), out);
      console.log(`  sample ${c.sample}: ${certNo(d)} (${tries} card(s) skipped)`);
      break;
    }
  }
}
await writeSamples();
if (process.env.SAMPLES_ONLY === '1') {
  await worker.terminate();
  process.exit(0);
}

const results = {};
const wrong = [];
let imageNo = 0;
for (const [cond, degrade] of Object.entries(CONDITIONS)) {
  results[cond] = {};
  for (const c of CASES) {
    const row = (results[cond][c.key] = { want: c.want, total: 0, correct: 0, qrRead: 0, ms: 0 });
    for (const d of c.docs) {
      const genuine = viewOf(d);
      const svg = certificateSvg(
        { view: c.alter(genuine), ...(await chainCard(d)) },
        { origin: ORIGIN, includeQr: !c.noQr }
      );
      const img = await degrade(sharp(Buffer.from(svg)).flatten({ background: '#fff' }), imageNo++);
      const buffer = await img.jpeg({ quality: 85 }).toBuffer();
      const started = Date.now();
      const evidence = await read(buffer);
      const out = await verifyCertificateEvidence(evidence, deps);
      row.ms += Date.now() - started;
      row.total += 1;
      if (evidence.qrText) row.qrRead += 1;
      if (out.verdict === c.want) row.correct += 1;
      else wrong.push({ cond, case: c.key, want: c.want, got: out.verdict, code: out.code, why: out.reason, cert: genuine.certificateNo, fields: out.fields?.filter((f) => !f.match) });
    }
    console.log(`${cond.padEnd(22)} ${c.key.padEnd(12)} ${row.correct}/${row.total} correct, QR read ${row.qrRead}/${row.total}`);
  }
}
await worker.terminate();

const sum = (o, k) => Object.values(o).reduce((n, r) => n + r[k], 0);
const lines = [
  '# Photo verification: OCR + QR measurement',
  '',
  `Generated ${new Date().toISOString()} by \`npm run chain:photos\`, ${PER_CASE} certificates per case.`,
  'Certificates rendered from the dataset, then degraded by software to imitate photos. **These are simulated conditions, not photos from a real camera.** Software-edited forgeries keep the original QR code.',
  '',
  '| Condition | Case | Expected | Correct | QR read |',
  '|---|---|---|---:|---:|',
  ...Object.entries(results).flatMap(([cond, rows]) =>
    Object.entries(rows).map(([k, r]) => `| ${cond} | ${k} | ${r.want} | ${r.correct}/${r.total} | ${r.qrRead}/${r.total} |`)
  ),
  '',
  ...Object.entries(results).map(([cond, rows]) => `- **${cond}: ${sum(rows, 'correct')}/${sum(rows, 'total')}** correct, about ${(sum(rows, 'ms') / sum(rows, 'total') / 1000).toFixed(1)} s per image`),
  '',
];
fs.writeFileSync(path.join(root, 'results', 'photo-ocr.md'), lines.join('\n'));
console.log('\n' + lines.slice(-Object.keys(results).length - 1).join('\n'));
if (wrong.length) console.log('Wrong:', JSON.stringify(wrong, null, 1));
