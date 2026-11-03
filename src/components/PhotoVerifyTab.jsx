import { useRef, useState } from 'react';
import { Ban, Check, CheckCircle2, ChevronDown, ImageUp, Link2, ScanText, X, XCircle } from 'lucide-react';
import Spinner from './Spinner';
import { txLink } from '../lib/wallet';
import { shortenHash } from './CredentialDNA';
import { verifyPhoto } from '../lib/api';
import { readCertificatePhoto } from '../lib/photoEvidence';

const SAMPLES = [
  { file: 'genuine-valid.jpg', label: 'Genuine' },
  { file: 'revoked.jpg', label: 'Revoked' },
  { file: 'forged-cgpa.jpg', label: 'Forged CGPA' },
  { file: 'forged-marks.jpg', label: 'Forged SGPA' },
  { file: 'forged-name.jpg', label: 'Forged name' },
  { file: 'fake-serial.jpg', label: 'Fake serial no.' },
];

const VERDICTS = {
  valid: { title: 'VALID', icon: CheckCircle2, tone: 'bg-valid-soft border-valid/30 text-valid' },
  invalid: { title: 'INVALID', icon: XCircle, tone: 'bg-invalid-soft border-invalid/30 text-invalid' },
  revoked: { title: 'REVOKED', icon: Ban, tone: 'bg-revoked-soft border-revoked/30 text-revoked' },
};

function Proof({ result }) {
  const { proof, hash, issuer } = result;
  if (!proof) return null;
  const tx = txLink(proof.txHash);
  const rows = [
    ['Network', proof.network ? `Ethereum ${proof.network}` : null],
    ['Smart contract', proof.contract ? <span key="c" className="font-mono">{shortenHash(proof.contract)}</span> : null],
    ['Recorded in block', proof.blockNumber != null ? `#${Number(proof.blockNumber).toLocaleString()}` : null],
    ['Confirmations (blocks since)', proof.confirmations != null ? Number(proof.confirmations).toLocaleString() : null],
    ['Block hash', proof.blockHash ? <span key="h" className="font-mono">{shortenHash(proof.blockHash)}</span> : null],
    [
      'Transaction',
      proof.txHash ? (
        tx ? <a key="t" href={tx} target="_blank" rel="noreferrer" className="font-mono text-teal underline">{shortenHash(proof.txHash)}</a> : <span key="t" className="font-mono">{shortenHash(proof.txHash)}</span>
      ) : null,
    ],
    ['Recorded as', proof.mode === 'merkle-batch' ? `Merkle batch #${proof.batchId}` : 'individual credential'],
    ['Merkle proof', proof.mode === 'merkle-batch' ? (proof.merkleProofValid ? `valid (${proof.merkleProof.length} hashes to the root)` : 'FAILED') : null],
    ['Issued by', issuer ? issuer.name : null],
    ['Issuer address', issuer ? <span key="a" className="font-mono">{shortenHash(issuer.address)}</span> : null],
    ['Recomputed hash = contract docHash', hash ? (hash.match ? 'yes' : 'NO') : 'not reached'],
  ].filter(([, v]) => v != null);
  return (
    <details className="border-t border-border pt-3 mt-4 group">
      <summary className="text-sm font-medium cursor-pointer flex items-center gap-1.5 list-none">
        <Link2 size={14} aria-hidden="true" />
        Blockchain proof
        <ChevronDown size={14} className="group-open:rotate-180 transition-transform" aria-hidden="true" />
      </summary>
      <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-1.5 mt-3 text-xs">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3">
            <dt className="text-ink-soft">{k}</dt>
            <dd className="text-right">{v}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

function PhotoResult({ result }) {
  const meta = VERDICTS[result.verdict];
  const Icon = meta.icon;
  return (
    <div className="mt-5" role="status">
      <div className={`rounded-lg border p-5 flex items-start gap-3 ${meta.tone}`}>
        <Icon size={30} className="shrink-0" aria-hidden="true" />
        <div>
          <p className="text-2xl font-bold tracking-wide">{meta.title}</p>
          <p className="text-sm text-ink mt-1">{result.reason}</p>
          {result.certificateNo && <p className="text-xs font-mono text-ink-soft mt-1">{result.certificateNo}</p>}
        </div>
      </div>
      {result.fields?.length > 0 && (
        <div className="mt-4">
          <p className="text-sm font-medium mb-2">Details read from the photo</p>
          <ul className="divide-y divide-border border border-border rounded-md bg-card">
            {result.fields.map((f) => (
              <li key={f.field} className="flex items-center gap-3 px-3 py-2 text-sm">
                {f.match ? (
                  <Check size={15} className="text-valid shrink-0" aria-label="Matches" />
                ) : (
                  <X size={15} className="text-invalid shrink-0" aria-label="Does not match" />
                )}
                <span className="text-ink-soft w-36 shrink-0 text-xs">{f.label}</span>
                <span className="break-words min-w-0">{f.found ?? 'not readable'}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <Proof result={result} />
    </div>
  );
}

/** Certificate photo in, valid / invalid / revoked out. */
export default function PhotoVerifyTab() {
  const [preview, setPreview] = useState(null);
  const [progress, setProgress] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const inputRef = useRef(null);

  const run = async (file) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Please choose a photo (JPG, PNG or WebP).');
      return;
    }
    setError('');
    setResult(null);
    setPreview((old) => {
      if (old) URL.revokeObjectURL(old);
      return URL.createObjectURL(file);
    });
    try {
      const evidence = await readCertificatePhoto(file, setProgress);
      if (!evidence.ocrText.trim() && !evidence.qrText) {
        setResult({ verdict: 'invalid', code: 'unreadable', reason: 'No text could be read from this image.' });
        return;
      }
      setProgress({ stage: 'Checking the blockchain', percent: 98 });
      setResult(await verifyPhoto(evidence));
    } catch (err) {
      // No verdict without the chain: never show "invalid" for a server failure.
      setError(err.message || 'Verification could not be completed. Try again.');
    } finally {
      setProgress(null);
    }
  };

  const trySample = async (name) => {
    setError('');
    try {
      const res = await fetch(`/samples/${name}`);
      if (!res.ok) throw new Error('Sample not available.');
      const blob = await res.blob();
      await run(new File([blob], name, { type: 'image/jpeg' }));
    } catch (err) {
      setError(err.message);
    }
  };

  const busy = Boolean(progress);
  return (
    <div>
      <button
        type="button"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          run(e.dataTransfer.files?.[0]);
        }}
        className="w-full border-2 border-dashed border-border rounded-lg p-6 text-center hover:border-teal/50 hover:bg-teal-soft/20 disabled:opacity-60"
      >
        {preview ? (
          <img src={preview} alt="Certificate being checked" className="max-h-56 mx-auto rounded" />
        ) : (
          <>
            <ImageUp size={26} className="mx-auto text-teal mb-2" aria-hidden="true" />
            <span className="block text-sm font-medium">Upload or photograph a certificate</span>
            <span className="block text-xs text-ink-soft mt-1">Keep the whole certificate flat, in focus and well lit.</span>
          </>
        )}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          run(e.target.files?.[0]);
          e.target.value = '';
        }}
      />

      {progress && (
        <div className="mt-4" aria-live="polite">
          <p className="text-sm flex items-center gap-2">
            <Spinner size={14} />
            {progress.stage}
          </p>
          <div className="h-1.5 bg-border rounded mt-2 overflow-hidden">
            <div className="h-full bg-teal transition-all" style={{ width: `${progress.percent}%` }} />
          </div>
        </div>
      )}
      {error && <p className="text-sm text-invalid mt-3">{error}</p>}
      {result && <PhotoResult result={result} />}

      <div className="mt-5">
        <p className="text-xs font-medium text-ink-soft mb-2 flex items-center gap-1.5">
          <ScanText size={13} aria-hidden="true" />
          Try a sample certificate photo
        </p>
        <div className="flex flex-wrap gap-2">
          {SAMPLES.map((s) => (
            <button
              key={s.file}
              type="button"
              disabled={busy}
              onClick={() => trySample(s.file)}
              className="text-xs border border-border rounded-md px-2.5 py-1.5 hover:bg-teal-soft/50 disabled:opacity-50"
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>
      <p className="text-[11px] text-ink-soft mt-4">
        The photo stays on this device. Only the text and QR code read from it are sent for checking.
      </p>
    </div>
  );
}
