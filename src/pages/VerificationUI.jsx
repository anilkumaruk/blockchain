import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  QrCode,
  Hash,
  Upload,
  ScanLine,
  ImageUp,
  Search,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ChevronDown,
  FileText,
  Building2,
  CalendarDays,
  Link2,
  BadgeCheck,
  Ban,
  X,
} from 'lucide-react';
import { useToast } from '../context/ToastContext';
import Spinner from '../components/Spinner';
import HashChip from '../components/HashChip';
import { verifyCredential, getAllCredentials } from '../lib/mockApi';

const TABS = [
  { key: 'scan', label: 'Scan QR', icon: QrCode },
  { key: 'id', label: 'Enter Credential ID', icon: Hash },
  { key: 'upload', label: 'Upload Certificate', icon: Upload },
];

export default function VerificationUI() {
  const { notify } = useToast();
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState('id');
  const [result, setResult] = useState(null); // { status, details }
  const [verifying, setVerifying] = useState(false);
  const [lastQuery, setLastQuery] = useState(null); // { type: 'id'|'hash', value }

  const prefilledId = searchParams.get('credentialId');

  const runVerify = async (payload, query) => {
    setVerifying(true);
    setResult(null);
    setLastQuery(query);
    try {
      const res = await verifyCredential(payload);
      setResult(res);
      if (res.status === 'valid') notify('Credential verified as valid.', 'success');
      else if (res.status === 'revoked') notify('Credential found but has been revoked.', 'warning');
      else notify('Verification failed — no match found.', 'error');
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-5 py-8">
      <div className="mb-6">
        <h1 className="text-xl font-semibold">Verify a Credential</h1>
        <p className="text-sm text-ink-soft mt-0.5">
          Confirm the authenticity of an academic credential against the on-chain record — by
          QR code, credential ID, or the certificate file itself.
        </p>
      </div>

      <div className="bg-card border border-border rounded-lg card-shadow overflow-hidden">
        <div className="flex border-b border-border">
          {TABS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => {
                setTab(key);
                setResult(null);
              }}
              className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-3.5 text-sm font-medium border-b-2 transition-colors ${
                tab === key
                  ? 'border-teal text-teal bg-teal-soft/40'
                  : 'border-transparent text-ink-soft hover:text-ink hover:bg-bg/60'
              }`}
            >
              <Icon size={15} />
              <span className="hidden xs:inline">{label}</span>
            </button>
          ))}
        </div>

        <div className="p-6">
          {tab === 'scan' && <ScanTab onVerify={runVerify} verifying={verifying} />}
          {tab === 'id' && (
            <IdTab onVerify={runVerify} verifying={verifying} prefilledId={prefilledId} />
          )}
          {tab === 'upload' && <UploadTab onVerify={runVerify} verifying={verifying} />}
        </div>
      </div>

      <div className="mt-5">
        {verifying && <VerifyingCard />}
        {!verifying && result && <ResultCard result={result} query={lastQuery} />}
      </div>

      <ExplainerCollapsible />
    </div>
  );
}

// ---- Scan QR tab ---------------------------------------------------------

function ScanTab({ onVerify, verifying }) {
  const [scanning, setScanning] = useState(false);
  const [demoId, setDemoId] = useState(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    getAllCredentials().then((list) => {
      const valid = list.find((c) => c.status === 'valid');
      if (valid) setDemoId(valid.credentialId);
    });
  }, []);

  const simulateScan = (source) => {
    setScanning(true);
    setTimeout(() => {
      setScanning(false);
      const id = demoId || 'COR-2023-9F3A1C';
      onVerify({ credentialId: id }, { type: 'id', value: id, via: source });
    }, 1400);
  };

  return (
    <div className="flex flex-col items-center">
      <div className="relative w-56 h-56 rounded-xl bg-ink flex items-center justify-center overflow-hidden mb-5">
        {/* corner brackets */}
        {['top-3 left-3 border-t-2 border-l-2', 'top-3 right-3 border-t-2 border-r-2', 'bottom-3 left-3 border-b-2 border-l-2', 'bottom-3 right-3 border-b-2 border-r-2'].map(
          (pos, i) => (
            <span key={i} className={`absolute w-6 h-6 border-teal/70 ${pos}`} />
          )
        )}
        {scanning ? (
          <span className="absolute left-3 right-3 h-0.5 bg-teal shadow-[0_0_8px_2px_rgba(46,85,104,0.7)] animate-scan-line" />
        ) : (
          <QrCode size={40} className="text-white/25" />
        )}
        <p className="absolute bottom-2 left-0 right-0 text-center text-[10px] text-white/50">
          {scanning ? 'Scanning…' : 'Camera preview (simulated)'}
        </p>
      </div>

      <p className="text-xs text-ink-soft mb-4 text-center max-w-xs">
        Point a camera at the credential's QR code. This prototype simulates the camera feed —
        press below to simulate a successful scan.
      </p>

      <div className="flex flex-col sm:flex-row gap-2 w-full max-w-xs">
        <button
          onClick={() => simulateScan('camera')}
          disabled={verifying || scanning}
          className="flex-1 flex items-center justify-center gap-1.5 bg-teal text-white text-sm font-medium rounded-md px-4 py-2.5 hover:bg-teal/90 disabled:opacity-60"
        >
          {scanning ? <Spinner size={14} /> : <ScanLine size={15} />}
          {scanning ? 'Scanning…' : 'Simulate scan'}
        </button>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={verifying || scanning}
          className="flex-1 flex items-center justify-center gap-1.5 border border-border text-sm font-medium rounded-md px-4 py-2.5 hover:bg-bg disabled:opacity-60"
        >
          <ImageUp size={15} />
          Upload QR image
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.[0]) simulateScan('image upload');
            e.target.value = '';
          }}
        />
      </div>
    </div>
  );
}

// ---- Enter ID tab ---------------------------------------------------------

function IdTab({ onVerify, verifying, prefilledId }) {
  const [value, setValue] = useState(prefilledId || '');

  useEffect(() => {
    if (prefilledId) setValue(prefilledId);
  }, [prefilledId]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!value.trim()) return;
    onVerify({ credentialId: value.trim() }, { type: 'id', value: value.trim() });
  };

  return (
    <form onSubmit={handleSubmit}>
      <label className="block text-xs font-medium text-ink-soft mb-1.5">Credential ID</label>
      <div className="flex gap-2">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="e.g. COR-2023-9F3A1C"
          className="flex-1 rounded-md border border-border bg-white px-3 py-2.5 text-sm font-mono outline-none focus:ring-2 focus:ring-teal/30 focus:border-teal"
        />
        <button
          type="submit"
          disabled={verifying || !value.trim()}
          className="flex items-center gap-1.5 bg-teal text-white text-sm font-medium rounded-md px-4 py-2.5 hover:bg-teal/90 disabled:opacity-50 shrink-0"
        >
          {verifying ? <Spinner size={14} /> : <Search size={15} />}
          Verify
        </button>
      </div>
      <p className="text-xs text-ink-soft mt-3">
        Try:{' '}
        {['COR-2023-9F3A1C', 'COR-2023-4B7E22', 'COR-9999-000000'].map((id, i) => (
          <button
            type="button"
            key={id}
            onClick={() => setValue(id)}
            className="font-mono text-teal hover:underline mr-2"
          >
            {id}
            {i < 2 ? ',' : ''}
          </button>
        ))}
      </p>
    </form>
  );
}

// ---- Upload Certificate tab -----------------------------------------------

async function realSha256Hex(file) {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buf);
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return '0x' + hex;
}

function UploadTab({ onVerify, verifying }) {
  const [file, setFile] = useState(null);
  const [hashing, setHashing] = useState(false);
  const [computedHash, setComputedHash] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef(null);

  const processFile = async (f) => {
    if (!f) return;
    setFile(f);
    setComputedHash(null);
    setHashing(true);
    try {
      const hex = await realSha256Hex(f);
      setComputedHash(hex);
    } finally {
      setHashing(false);
    }
  };

  const handleVerify = () => {
    if (!computedHash) return;
    onVerify({ fileHash: computedHash }, { type: 'hash', value: computedHash, fileName: file?.name });
  };

  const clearFile = () => {
    setFile(null);
    setComputedHash(null);
  };

  return (
    <div>
      {!file ? (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            if (e.dataTransfer.files?.[0]) processFile(e.dataTransfer.files[0]);
          }}
          onClick={() => inputRef.current?.click()}
          className={`border-2 border-dashed rounded-lg p-10 flex flex-col items-center justify-center text-center cursor-pointer transition-colors ${
            dragOver ? 'border-teal bg-teal-soft/40' : 'border-border hover:border-teal/50 hover:bg-bg/60'
          }`}
        >
          <FileText size={26} className="text-ink-soft mb-3" />
          <p className="text-sm font-medium mb-1">Drop the certificate file here</p>
          <p className="text-xs text-ink-soft mb-1">or click to browse (PDF, image, etc.)</p>
          <p className="text-[11px] text-ink-soft/70">
            Its SHA-256 is computed locally in your browser — the file is never uploaded anywhere.
          </p>
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && processFile(e.target.files[0])}
          />
        </div>
      ) : (
        <div className="border border-border rounded-lg p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2 min-w-0">
              <FileText size={16} className="text-teal shrink-0" />
              <span className="text-sm font-medium truncate">{file.name}</span>
              <span className="text-xs text-ink-soft shrink-0">
                ({(file.size / 1024).toFixed(1)} KB)
              </span>
            </div>
            <button
              onClick={clearFile}
              className="text-ink-soft hover:text-ink shrink-0"
              aria-label="Remove file"
            >
              <X size={16} />
            </button>
          </div>

          {hashing ? (
            <div className="flex items-center gap-2 text-sm text-ink-soft mb-4">
              <Spinner size={15} />
              Computing SHA-256 of the file (Web Crypto API)…
            </div>
          ) : (
            computedHash && (
              <div className="mb-4">
                <p className="text-xs text-ink-soft mb-1.5">Computed document hash</p>
                <HashChip value={computedHash} />
              </div>
            )
          )}

          <button
            onClick={handleVerify}
            disabled={!computedHash || verifying}
            className="w-full flex items-center justify-center gap-1.5 bg-teal text-white text-sm font-medium rounded-md px-4 py-2.5 hover:bg-teal/90 disabled:opacity-50"
          >
            {verifying ? <Spinner size={14} /> : <Search size={15} />}
            Compare against blockchain record
          </button>
        </div>
      )}
    </div>
  );
}

// ---- Result & supporting UI ------------------------------------------------

function VerifyingCard() {
  return (
    <div className="bg-card border border-border rounded-lg card-shadow p-6 flex items-center gap-3">
      <Spinner size={18} className="text-teal" />
      <p className="text-sm text-ink-soft">Checking the on-chain record…</p>
    </div>
  );
}

const RESULT_CONFIG = {
  valid: {
    icon: CheckCircle2,
    title: 'Valid credential',
    bg: 'bg-valid-soft',
    border: 'border-valid/30',
    text: 'text-valid',
  },
  invalid: {
    icon: XCircle,
    title: 'Invalid credential',
    bg: 'bg-invalid-soft',
    border: 'border-invalid/30',
    text: 'text-invalid',
  },
  revoked: {
    icon: AlertTriangle,
    title: 'Credential revoked',
    bg: 'bg-revoked-soft',
    border: 'border-revoked/30',
    text: 'text-revoked',
  },
};

function ResultCard({ result, query }) {
  const cfg = RESULT_CONFIG[result.status];
  const Icon = cfg.icon;
  const d = result.details;

  return (
    <div className={`rounded-lg border card-shadow p-6 ${cfg.bg} ${cfg.border}`}>
      <div className="flex items-start gap-3 mb-4">
        <span className={`w-10 h-10 rounded-full bg-white flex items-center justify-center shrink-0 ${cfg.text}`}>
          <Icon size={20} />
        </span>
        <div>
          <h3 className={`text-base font-semibold ${cfg.text}`}>{cfg.title}</h3>
          <p className="text-sm text-ink-soft mt-0.5">
            {result.status === 'valid' &&
              'This credential matches an active record on-chain and has not been revoked.'}
            {result.status === 'revoked' &&
              'This credential was issued but has since been revoked by the issuing institution.'}
            {result.status === 'invalid' && d.reason}
          </p>
        </div>
      </div>

      {result.status === 'valid' && (
        <div className="bg-white rounded-md border border-border p-4 space-y-3">
          <DetailRow icon={BadgeCheck} label="Credential type" value={d.credentialType} />
          <DetailRow icon={Building2} label="Issuer" value={d.issuer} />
          <DetailRow icon={CalendarDays} label="Issue date" value={d.issueDate} />
          <DetailRow icon={Hash} label="Credential ID" value={d.credentialId} mono />
          <div className="pt-1">
            <HashChip label="Tx reference" value={d.txHash} />
          </div>
        </div>
      )}

      {result.status === 'revoked' && (
        <div className="bg-white rounded-md border border-border p-4 space-y-3">
          <DetailRow icon={BadgeCheck} label="Credential type" value={d.credentialType} />
          <DetailRow icon={Building2} label="Issuer" value={d.issuer} />
          <DetailRow icon={CalendarDays} label="Original issue date" value={d.issueDate} />
          <DetailRow icon={Hash} label="Credential ID" value={d.credentialId} mono />
          <div className="border-t border-border pt-3 space-y-2">
            <DetailRow
              icon={Ban}
              label="Revocation date"
              value={d.revocation?.date}
              accent="text-revoked"
            />
            <div>
              <p className="text-xs text-ink-soft mb-0.5 flex items-center gap-1.5">
                <Link2 size={13} /> Revocation reason
              </p>
              <p className="text-sm text-ink pl-[19px]">{d.revocation?.reason}</p>
            </div>
          </div>
        </div>
      )}

      {result.status === 'invalid' && (
        <div className="bg-white rounded-md border border-border p-4 space-y-2 text-sm">
          {query?.type === 'id' && (
            <p className="text-ink-soft">
              Submitted ID: <span className="font-mono text-ink">{d.submittedId}</span>
            </p>
          )}
          {query?.type === 'hash' && (
            <p className="text-ink-soft break-all">
              Computed hash: <span className="font-mono text-ink">{d.submittedHash}</span>
              {query.fileName && <span className="block mt-0.5">from file "{query.fileName}"</span>}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function DetailRow({ icon: Icon, label, value, mono, accent }) {
  return (
    <div className="flex items-center gap-2">
      <Icon size={14} className="text-ink-soft shrink-0" />
      <span className="text-xs text-ink-soft w-32 shrink-0">{label}</span>
      <span className={`text-sm ${mono ? 'font-mono' : 'font-medium'} ${accent || 'text-ink'}`}>
        {value}
      </span>
    </div>
  );
}

function ExplainerCollapsible() {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-6 border border-border rounded-lg bg-card overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-5 py-3.5 text-left"
      >
        <span className="text-sm font-medium">How verification works</span>
        <ChevronDown
          size={16}
          className={`text-ink-soft transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <div className="px-5 pb-5 text-sm text-ink-soft space-y-3 border-t border-border pt-4">
          <Step
            n={1}
            title="A certificate PDF is generated"
            body="When the institution issues a credential, a PDF certificate is generated containing the student and credential details."
          />
          <Step
            n={2}
            title="Its SHA-256 hash is computed"
            body="A cryptographic hash (a fixed-length fingerprint) of the document is calculated. Even a single changed character produces a completely different hash."
          />
          <Step
            n={3}
            title="Only the hash is written on-chain"
            body="The hash — never the PDF itself — is recorded in a smart-contract transaction, alongside the credential ID. This keeps documents private while making tampering detectable."
          />
          <Step
            n={4}
            title="Verifiers recompute and compare"
            body="Anyone can hash their own copy of the certificate and compare it against the on-chain hash. A match proves the document is authentic and unaltered."
          />
        </div>
      )}
    </div>
  );
}

function Step({ n, title, body }) {
  return (
    <div className="flex gap-3">
      <span className="w-5 h-5 rounded-full bg-teal-soft text-teal text-xs font-semibold flex items-center justify-center shrink-0 mt-0.5">
        {n}
      </span>
      <div>
        <p className="text-ink font-medium text-sm">{title}</p>
        <p className="text-ink-soft text-sm mt-0.5">{body}</p>
      </div>
    </div>
  );
}
