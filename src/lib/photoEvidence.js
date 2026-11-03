// Reads a certificate photo in the browser: QR code + OCR text. The image is
// never uploaded; only what was read from it goes to the server.
import QrScanner from 'qr-scanner';

const TARGET_WIDTH = 2000;
const MAX_WIDTH = 2600;

/** Greyscale + contrast stretch on a canvas: OCR copes far better with this than a raw photo. */
async function preprocess(file) {
  const bitmap = await createImageBitmap(file);
  const up = bitmap.width < TARGET_WIDTH ? TARGET_WIDTH / bitmap.width : Math.min(1, MAX_WIDTH / bitmap.width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * up);
  canvas.height = Math.round(bitmap.height * up);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = image.data;
  let min = 255;
  let max = 0;
  for (let i = 0; i < px.length; i += 4) {
    const v = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    px[i] = v;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const range = Math.max(1, max - min);
  for (let i = 0; i < px.length; i += 4) {
    const v = ((px[i] - min) * 255) / range;
    px[i] = px[i + 1] = px[i + 2] = v;
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

async function readQr(file) {
  try {
    const result = await QrScanner.scanImage(file, { returnDetailedScanResult: true });
    return result.data || '';
  } catch {
    return ''; // no readable QR code: the printed number is used instead
  }
}

/** @param {File|Blob} file @param {(progress: {stage: string, percent: number}) => void} onProgress */
export async function readCertificatePhoto(file, onProgress = () => {}) {
  onProgress({ stage: 'Looking for a QR code', percent: 5 });
  const qrText = await readQr(file);
  onProgress({ stage: 'Preparing the image', percent: 10 });
  const canvas = await preprocess(file);
  onProgress({ stage: 'Loading text recognition', percent: 15 });
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker('eng', 1, {
    workerPath: '/tesseract/worker.min.js',
    corePath: '/tesseract/',
    langPath: '/tesseract',
    logger: (m) => {
      if (m.status === 'recognizing text') {
        onProgress({ stage: 'Reading the certificate text', percent: 20 + Math.round(m.progress * 35) });
      }
    },
  });
  try {
    // Two passes: page layout reads the fields best, a single text block reads table rows best.
    await worker.setParameters({ preserve_interword_spaces: '1', tessedit_pageseg_mode: '3' }); // wide gaps separate columns
    // rotateAuto straightens the image: a slight tilt would otherwise split table rows across lines.
    const { data: page } = await worker.recognize(canvas, { rotateAuto: true });
    onProgress({ stage: 'Reading the semester table', percent: 60 });
    await worker.setParameters({ tessedit_pageseg_mode: '6' });
    const { data: block } = await worker.recognize(canvas, { rotateAuto: true });
    // Third pass: only characters a table row can contain, which sharpens digit reading.
    onProgress({ stage: 'Double-checking the marks', percent: 80 });
    await worker.setParameters({ tessedit_char_whitelist: 'Sem0123456789.PASFIL ' });
    const { data: digits } = await worker.recognize(canvas, { rotateAuto: true });
    return { ocrText: `${page.text}\n${block.text}\n${digits.text}`, qrText };
  } finally {
    await worker.terminate();
  }
}
