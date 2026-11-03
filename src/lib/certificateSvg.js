// Draws the downloadable marks card as SVG (browser download and sample photos).
// All statements on it are generated from real data: "Verified" appears only
// when the chain confirms the record, and every printed value can be read back
// from a photo ("Label: value" text), so the card can itself be verified.

import QRCode from 'qrcode';
import { verifyUrl } from './certificateView.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const clip = (s, n) => (String(s ?? '').length > n ? `${String(s).slice(0, n - 1)}…` : String(s ?? ''));
const shortHash = (h) => (h ? `${h.slice(0, 8)}...${h.slice(-6)}` : '-');

export const CERT_WIDTH = 2000;
const PURPLE = '#5B2FC9';
const LILAC = '#E4DCFA';
const NAVY = '#17244F';
const INK = '#141B34';
const MUTED = '#4B5270';
const LINE = '#CFC6EA';
const GREEN = '#117A3F';
const GREEN_SOFT = '#DDF5E5';
const RED = '#B42318';
const RED_SOFT = '#FBE4E1';
const FONT = 'Arial, Helvetica, sans-serif';

const t = (x, y, text, { size = 24, weight = 'normal', fill = INK, anchor = 'start' } = {}) =>
  `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${esc(text)}</text>`;
const box = (x, y, w, h, { r = 16, fill = '#fff', stroke = LINE } = {}) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" stroke="${stroke}" stroke-width="2"/>`;
const tick = (x, y, color) =>
  `<circle cx="${x}" cy="${y}" r="12" fill="${color}"/><path d="M${x - 6} ${y}l4 5 8-9" fill="none" stroke="#fff" stroke-width="3"/>`;
const cube = (x, y, s, fill = '#fff') =>
  `<path d="M${x} ${y - s}L${x + s} ${y - s / 2}V${y + s / 2}L${x} ${y + s}L${x - s} ${y + s / 2}V${y - s / 2}Z" fill="${fill}"/><path d="M${x - s} ${y - s / 2}L${x} ${y}L${x + s} ${y - s / 2}M${x} ${y}V${y + s}" stroke="#ffffff99" stroke-width="2" fill="none"/>`;

function qrSvg(text, x, y, size) {
  const { modules } = QRCode.create(text, { errorCorrectionLevel: 'L' });
  const cell = Math.floor(size / modules.size);
  let path = '';
  for (let r = 0; r < modules.size; r++) {
    for (let c = 0; c < modules.size; c++) {
      if (modules.get(r, c)) path += `M${x + c * cell} ${y + r * cell}h${cell}v${cell}h-${cell}z`;
    }
  }
  return `<path d="${path}" fill="#000"/>`;
}

/**
 * @param {object} card { view, hash, txId, block, status: 'valid'|'revoked', marksVerified }
 * @param {{ origin: string, includeQr?: boolean }} options
 */
export function certificateSvg(card, { origin, includeQr = true }) {
  const { view, hash, txId, status = 'valid', marksVerified = false } = card;
  const revoked = status === 'revoked';
  const semesters = view.semesters ?? [];
  const rowH = 44;
  const tableH = semesters.length ? 56 + semesters.length * rowH : 0;
  const tableY = 640;
  const tilesY = tableY + tableH + (semesters.length ? 24 : 0);
  const footerY = tilesY + 140;
  const height = footerY + 245;
  const parts = [];

  parts.push(`<rect width="${CERT_WIDTH}" height="${height}" fill="#fff"/>`);
  parts.push(`<rect x="16" y="16" width="${CERT_WIDTH - 32}" height="${height - 32}" rx="24" fill="none" stroke="${PURPLE}" stroke-width="3"/>`);
  parts.push(`<path d="M18 40Q18 18 40 18H190L18 190Z" fill="${PURPLE}"/><path d="M190 18H310L230 88H150Z" fill="${LILAC}"/>`);
  parts.push(`<path d="M${CERT_WIDTH - 18} ${height - 200}V${height - 40}Q${CERT_WIDTH - 18} ${height - 18} ${CERT_WIDTH - 40} ${height - 18}H${CERT_WIDTH - 200}Z" fill="${LILAC}"/>`);

  // Header
  parts.push(`<path d="M620 72L690 44L760 72L690 100Z" fill="${NAVY}"/><path d="M650 88V112Q690 134 730 112V88L690 104Z" fill="${NAVY}"/>`);
  parts.push(t(790, 78, 'Academic Credential System', { size: 50, weight: 'bold', fill: NAVY }));
  parts.push(t(1072, 120, 'Blockchain Based Verification', { size: 30, fill: MUTED, anchor: 'middle' }));
  const badgeFill = revoked ? RED : PURPLE;
  parts.push(`<rect x="1570" y="52" width="384" height="70" rx="14" fill="${badgeFill}"/>`);
  if (!revoked) parts.push(cube(1612, 87, 18));
  parts.push(t(revoked ? 1762 : 1646, 97, revoked ? 'REVOKED' : 'Blockchain Verified', { size: 30, weight: 'bold', fill: '#fff', anchor: revoked ? 'middle' : 'start' }));
  parts.push(t(1000, 212, view.title, { size: 76, weight: 'bold', fill: NAVY, anchor: 'middle' }));
  parts.push(`<rect x="690" y="236" width="620" height="56" rx="28" fill="${LILAC}"/>`);
  parts.push(t(1000, 274, 'Semester-wise Academic Record', { size: 32, weight: 'bold', fill: NAVY, anchor: 'middle' }));

  // Student details
  parts.push(box(50, 316, 1350, 304));
  parts.push(`<rect x="76" y="346" width="150" height="190" rx="18" fill="#E7E6F5"/><circle cx="151" cy="410" r="36" fill="#9AA3CC"/><path d="M92 530Q92 460 151 460Q210 460 210 530Z" fill="#9AA3CC"/>`);
  const left = [
    ['Certificate No', view.certificateNo],
    ['Student Name', view.name],
    ['Registration No', view.registerNo],
    ['Date of Birth', view.dob],
    ['University', view.university],
    ['Degree', view.degree],
    ['Branch', view.branch],
  ].filter(([, v]) => v);
  const right = [
    ['Program', view.program],
    ['Medium', view.medium],
    ['Batch', view.batch],
    ['Year of Passing', view.year],
    ['Date of Issue', view.dateOfIssue],
  ].filter(([, v]) => v);
  // Never shortened: every printed value is compared with the record. Long ones just print smaller.
  left.forEach(([label, value], i) => {
    const text = `${label}: ${value}`;
    parts.push(t(250, 360 + i * 39, text, { size: text.length > 52 ? 24 : 29 }));
  });
  right.forEach(([label, value], i) => parts.push(t(1040, 360 + i * 39, `${label}: ${value}`, { size: 25 })));

  // Semester table
  if (semesters.length) {
    const cols = [50, 220, 470, 660, 940, 1120, 1400];
    parts.push(`<rect x="50" y="${tableY}" width="1350" height="${tableH}" rx="16" fill="#fff" stroke="${NAVY}" stroke-width="2"/>`);
    parts.push(`<path d="M50 ${tableY + 56}V${tableY + 16}Q50 ${tableY} 66 ${tableY}H1384Q1400 ${tableY} 1400 ${tableY + 16}V${tableY + 56}Z" fill="${NAVY}"/>`);
    ['Sem', 'Credit Points', 'SGPA', 'Result', 'Backlogs', 'Verification'].forEach((h, i) => {
      parts.push(t((cols[i] + cols[i + 1]) / 2, tableY + 38, h, { size: 26, weight: 'bold', fill: '#fff', anchor: 'middle' }));
    });
    semesters.forEach((s, i) => {
      const y = tableY + 56 + i * rowH;
      const base = y + 30;
      if (i) parts.push(`<line x1="50" x2="1400" y1="${y}" y2="${y}" stroke="${LINE}"/>`);
      const cells = [`Sem ${s.semester}`, s.credits_earned, Number(s.sgpa).toFixed(2), String(s.result).split(' ')[0], s.backlogs];
      cells.forEach((v, c) => parts.push(t((cols[c] + cols[c + 1]) / 2, base, v, { size: 29, anchor: 'middle', weight: c === 0 ? 'bold' : 'normal' })));
      const ok = marksVerified && !revoked;
      const cx = (cols[5] + cols[6]) / 2;
      parts.push(`<rect x="${cx - 88}" y="${y + 6}" width="176" height="31" rx="15" fill="${ok ? GREEN_SOFT : RED_SOFT}"/>`);
      parts.push(tick(cx - 66, y + 21, ok ? GREEN : RED));
      parts.push(t(cx + 8, base - 2, ok ? 'Verified' : revoked ? 'Revoked' : 'Unverified', { size: 23, weight: 'bold', fill: ok ? GREEN : RED, anchor: 'middle' }));
    });
  }

  // Totals
  const totalCredits = semesters.reduce((n, s) => n + Number(s.credits_earned || 0), 0);
  const tiles = [
    view.score != null ? [`CGPA or Percentage: ${view.score}`] : null,
    semesters.length ? [`Total Credit Points: ${totalCredits}`] : null,
    view.classAwarded ? [`Overall Result: ${view.classAwarded}`] : null,
  ].filter(Boolean);
  const tileW = tiles.length ? (1350 - (tiles.length - 1) * 24) / tiles.length : 0;
  tiles.forEach(([text], i) => {
    const x = 50 + i * (tileW + 24);
    const last = i === tiles.length - 1 && view.classAwarded;
    parts.push(box(x, tilesY, tileW, 104, last ? { fill: GREEN_SOFT, stroke: '#A9E3BE' } : {}));
    parts.push(t(x + 24, tilesY + 62, text, { size: text.length > 32 ? 23 : 27, weight: 'bold' }));
  });

  // Blockchain panel
  parts.push(box(1430, 316, 524, Math.max(footerY - 340, 500)));
  parts.push(cube(1500, 380, 26, PURPLE), cube(1470, 430, 22, PURPLE), cube(1530, 430, 22, PURPLE));
  parts.push(t(1576, 386, 'Blockchain', { size: 32, weight: 'bold', fill: NAVY }), t(1576, 426, 'Academic Credential', { size: 32, weight: 'bold', fill: NAVY }));
  parts.push(t(1456, 490, 'Recorded on the Chain of Record blockchain.', { size: 22, fill: MUTED }));
  parts.push(t(1456, 520, 'Tamper-evident and independently verifiable.', { size: 22, fill: MUTED }));
  parts.push(`<line x1="1430" x2="1954" y1="548" y2="548" stroke="${LINE}"/>`);
  parts.push(t(1456, 598, 'Verification Status', { size: 25, weight: 'bold' }));
  parts.push(`<rect x="1740" y="568" width="190" height="44" rx="22" fill="${revoked ? RED_SOFT : GREEN_SOFT}"/>`);
  parts.push(t(1835, 598, revoked ? 'Revoked' : 'Verified', { size: 25, weight: 'bold', fill: revoked ? RED : GREEN, anchor: 'middle' }));
  parts.push(t(1456, 664, 'Blockchain Txn ID', { size: 25, weight: 'bold' }), t(1456, 698, shortHash(txId), { size: 24, fill: MUTED }));
  parts.push(t(1456, 750, 'Document Hash', { size: 25, weight: 'bold' }), t(1456, 784, shortHash(hash), { size: 24, fill: MUTED }));
  parts.push(t(1456, 836, 'Credential ID', { size: 25, weight: 'bold' }), t(1456, 872, clip(view.certificateNo, 32), { size: 27, weight: 'bold', fill: INK }));

  // Footer
  parts.push(`<line x1="50" x2="1954" y1="${footerY}" y2="${footerY}" stroke="${LINE}"/>`);
  const link = verifyUrl(origin, view.certificateNo, hash);
  if (includeQr) parts.push(qrSvg(link, 44, footerY + 10, 200));
  parts.push(t(270, footerY + 70, 'Scan to Verify', { size: 32, weight: 'bold' }));
  parts.push(t(270, footerY + 110, 'Scan this QR code or open the link', { size: 24, fill: MUTED }));
  parts.push(t(270, footerY + 142, 'to validate this marks card on the blockchain.', { size: 24, fill: MUTED }));
  parts.push(t(860, footerY + 70, 'Verification Link', { size: 30, weight: 'bold' }));
  parts.push(`<rect x="860" y="${footerY + 88}" width="620" height="50" rx="25" fill="${LILAC}"/>`);
  parts.push(t(884, footerY + 122, clip(`${new URL(origin).host}/verify`, 44), { size: 24, fill: NAVY }));
  parts.push(`<path d="M1600 ${footerY + 78}q18-48 34-30t-14 30q30-44 40-22t30-8" fill="none" stroke="#111" stroke-width="3"/>`);
  parts.push(`<line x1="1540" x2="1900" y1="${footerY + 96}" y2="${footerY + 96}" stroke="${LINE}"/>`);
  parts.push(t(1720, footerY + 128, 'Controller of Examinations', { size: 26, weight: 'bold', anchor: 'middle' }));
  parts.push(t(1000, height - 30, 'Student project prototype using synthetic data. Not an official university document.', { size: 20, fill: MUTED, anchor: 'middle' }));

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CERT_WIDTH}" height="${height}" viewBox="0 0 ${CERT_WIDTH} ${height}">${parts.join('')}</svg>`;
}

/** Browser only: renders the marks card to a PNG and downloads it. */
export async function downloadCertificateImage(card) {
  const svg = certificateSvg(card, { origin: window.location.origin });
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  const img = new Image();
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = reject;
    img.src = url;
  });
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  canvas.getContext('2d').drawImage(img, 0, 0);
  URL.revokeObjectURL(url);
  const a = document.createElement('a');
  a.href = canvas.toDataURL('image/png');
  a.download = `marks-card-${String(card.view.certificateNo).replace(/[^A-Za-z0-9-]/g, '-')}.png`;
  a.click();
}
