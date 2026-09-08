import { useEffect, useRef, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
  QrCode,
  Hash,
  Upload,
  Search,
  ChevronDown,
  FileText,
  X,
  ShieldCheck,
  Fingerprint,
  Database,
  ScanEye,
  ArrowRight,
  UserSearch,
  ExternalLink,
  Sparkles,
} from 'lucide-react';
import { useToast } from '../context/ToastContext';
import Spinner from '../components/Spinner';
import HashChip from '../components/HashChip';
import VerificationResult from '../components/VerificationResult';
import VerificationHistory, {
  loadVerificationHistory,
  pushVerificationHistory,
  clearVerificationHistory,
} from '../components/VerificationHistory';
import QrScanTab from '../components/QrScanTab';
import { verifyCredential, getAllCredentials } from '../lib/mockApi';
import { resolveVerificationState } from '../lib/verification';

const TABS = [
  { key: 'id', label: 'Credential ID', icon: Hash },
  { key: 'upload', label: 'Upload Certificate', icon: Upload },
  { key: 'qr', label: 'Scan QR Code', icon: QrCode },
  { key: 'profile', label: 'Candidate Profile', icon: UserSearch },
];

export default function VerificationUI() {
  const { notify } = useToast();
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState('id');
  const [idValue, setIdValue] = useState('');
  const [result, setResult] = useState(null);
  const [verifying, setVerifying] = useState(false);
  const [lastQuery, setLastQuery] = useState(null);
  const [verifiedAt, setVerifiedAt] = useState(null);
  const [lastVerifiedCredential, setLastVerifiedCredential] = useState(null);
  const [history, setHistory] = useState(() => loadVerificationHistory());
  const idInputRef = useRef(null);
  const autoVerifiedRef = useRef(false);

  const prefilledId = searchParams.get('credentialId');

  useEffect(() => {
    if (prefilledId) setIdValue(prefilledId);
  }, [prefilledId]);

  const runVerify = async (payload, query) => {
    setVerifying(true);
    setResult(null);
    setLastQuery(query);
    try {
      const res = await verifyCredential(payload);
      setResult(res);
      setVerifiedAt(new Date());
      const state = resolveVerificationState(res.status, query.type);

      if (state === 'verified' || state === 'revoked') {
        setLastVerifiedCredential(res.details);
      }

      const label =
        state === 'not_found'
          ? `ID: ${res.details.submittedId}`
          : state === 'mismatch'
          ? query.fileName || 'Uploaded file'
          : `${res.details.studentName} — ${res.details.credentialType}`;

      setHistory(
        pushVerificationHistory({
          result: state,
          label,
          credentialId: state === 'verified' || state === 'revoked' ? res.details.credentialId : null,
        })
      );

      if (res.status === 'valid') notify('Credential verified as valid.', 'success');
      else if (res.status === 'revoked') notify('Credential found but has been revoked.', 'warning');
      else if (state === 'mismatch') notify('Document fingerprint does not match.', 'error');
      else notify('No matching credential found.', 'error');
    } finally {
      setVerifying(false);
    }
  };

  // Arriving from a Public Profile's "Verify credential" link should feel
  // instant — the ID is already known, so there's no reason to make the
  // recruiter click Verify again.
  useEffect(() => {
    if (prefilledId && !autoVerifiedRef.current) {
      autoVerifiedRef.current = true;
      runVerify({ credentialId: prefilledId }, { type: 'id', value: prefilledId });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefilledId]);

  const handlePickId = (id) => {
    setIdValue(id);
    setTab('id');
    setResult(null);
    idInputRef.current?.focus();
  };

  const handleClearHistory = () => {
    clearVerificationHistory();
    setHistory([]);
  };

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-5 py-8">
      <Hero
        onVerifyCredential={() => {
          setTab('id');
          setTimeout(() => idInputRef.current?.focus(), 0);
        }}
        onVerifyCandidate={() => setTab('profile')}
      />

      <p className="text-xs font-semibold text-ink-soft uppercase tracking-wide mb-2">
        Choose how to verify
      </p>

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
          {tab === 'id' && (
            <IdTab
              value={idValue}
              onChange={setIdValue}
              onSubmit={() =>
                idValue.trim() &&
                runVerify({ credentialId: idValue.trim() }, { type: 'id', value: idValue.trim() })
              }
              verifying={verifying}
              inputRef={idInputRef}
            />
          )}
          {tab === 'upload' && <UploadTab onVerify={runVerify} verifying={verifying} />}
          {tab === 'qr' && <QrScanTab onFallback={() => setTab('profile')} />}
          {tab === 'profile' && <ProfileTab />}
        </div>
      </div>

      <div className="mt-5">
        {verifying && <VerifyingCard />}
        {!verifying && result && (
          <VerificationResult
            result={result}
            queryType={lastQuery?.type}
            verifiedAt={verifiedAt}
            referenceCredential={lastVerifiedCredential}
          />
        )}
      </div>

      <QuickDemo onPick={handlePickId} />

      <VerificationHistory entries={history} onSelect={handlePickId} onClear={handleClearHistory} />

      <ExplainerCollapsible />
    </div>
  );
}

// ---- Hero -------------------------------------------------------------------

function Hero({ onVerifyCredential, onVerifyCandidate }) {
  return (
    <div className="mb-7">
      <p className="text-[11px] font-semibold tracking-[0.14em] text-teal uppercase mb-2">
        Employer verification
      </p>
      <h1 className="text-2xl sm:text-3xl font-semibold leading-tight mb-2">
        Verify Academic Credentials
      </h1>
      <p className="text-sm text-ink-soft max-w-xl mb-1.5">
        Confirm that a credential was issued by the institution, has not been revoked, and matches
        its registered digital fingerprint.
      </p>
      <p className="text-xs text-ink-soft/70 italic mb-5">
        Don't trust the PDF. Verify the credential behind it.
      </p>

      <div className="flex items-center gap-1.5 mb-5 text-xs font-medium">
        <Pill>Verify</Pill>
        <ArrowRight size={11} className="text-ink-soft" aria-hidden="true" />
        <Pill>Authenticate</Pill>
        <ArrowRight size={11} className="text-ink-soft" aria-hidden="true" />
        <Pill accent>Trust</Pill>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={onVerifyCredential}
          className="flex items-center gap-1.5 bg-teal text-white text-sm font-medium rounded-md px-4 py-2.5 hover:bg-teal/90"
        >
          <Search size={15} aria-hidden="true" />
          Verify Credential
        </button>
        <button
          onClick={onVerifyCandidate}
          className="flex items-center gap-1.5 border border-border text-sm font-medium rounded-md px-4 py-2.5 hover:bg-bg"
        >
          <UserSearch size={15} aria-hidden="true" />
          Verify Candidate
        </button>
      </div>
    </div>
  );
}

function Pill({ children, accent }) {
  return (
    <span
      className={`px-2.5 py-1 rounded-full border ${
        accent ? 'bg-teal text-white border-teal' : 'bg-bg border-border text-ink-soft'
      }`}
    >
      {children}
    </span>
  );
}

// ---- Credential ID tab --------------------------------------------------------

function IdTab({ value, onChange, onSubmit, verifying, inputRef }) {
  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit();
  };

  return (
    <form onSubmit={handleSubmit}>
      <label htmlFor="verifier-credential-id" className="block text-xs font-medium text-ink-soft mb-1.5">
        Credential ID
      </label>
      <div className="flex gap-2">
        <input
          id="verifier-credential-id"
          ref={inputRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="e.g. COR-2023-9F3A1C"
          className="flex-1 rounded-md border border-border bg-white px-3 py-2.5 text-sm font-mono outline-none focus:ring-2 focus:ring-teal/30 focus:border-teal"
        />
        <button
          type="submit"
          disabled={verifying || !value.trim()}
          className="flex items-center gap-1.5 bg-teal text-white text-sm font-medium rounded-md px-4 py-2.5 hover:bg-teal/90 disabled:opacity-50 shrink-0"
        >
          {verifying ? <Spinner size={14} /> : <Search size={15} />}
          Verify Credential
        </button>
      </div>
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
      <p className="flex flex-wrap items-center gap-1.5 text-[11px] text-ink-soft mb-4">
        <span>Upload</span>
        <ArrowRight size={10} aria-hidden="true" />
        <span>Calculate SHA-256</span>
        <ArrowRight size={10} aria-hidden="true" />
        <span>Compare with registered Credential DNA</span>
        <ArrowRight size={10} aria-hidden="true" />
        <span>Return result</span>
      </p>

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
            Compare against registered credential fingerprint
          </button>
        </div>
      )}
    </div>
  );
}

// ---- Candidate profile tab -----------------------------------------------

function ProfileTab() {
  const navigate = useNavigate();
  const [value, setValue] = useState('');

  const extractId = (input) => {
    const trimmed = input.trim();
    const match = trimmed.match(/\/profile\/([^/?#]+)/);
    return match ? decodeURIComponent(match[1]) : trimmed;
  };

  const handleOpen = (e) => {
    e.preventDefault();
    const id = extractId(value);
    if (!id) return;
    navigate(`/profile/${encodeURIComponent(id)}`);
  };

  return (
    <div>
      <p className="text-sm text-ink-soft mb-4">
        Open a candidate's Verified Professional Passport to see their academic credentials, then
        verify any of them individually from there.
      </p>
      <form onSubmit={handleOpen} className="flex gap-2 mb-3">
        <label htmlFor="verifier-profile-link" className="sr-only">
          Candidate profile link or student ID
        </label>
        <input
          id="verifier-profile-link"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Paste a profile link or enter a student ID"
          className="flex-1 rounded-md border border-border bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-teal/30 focus:border-teal"
        />
        <button
          type="submit"
          disabled={!value.trim()}
          className="flex items-center gap-1.5 bg-teal text-white text-sm font-medium rounded-md px-4 py-2.5 hover:bg-teal/90 disabled:opacity-50 shrink-0"
        >
          <ExternalLink size={15} aria-hidden="true" />
          Open candidate profile
        </button>
      </form>
      <p className="text-[11px] text-ink-soft">
        Camera-based QR scanning is planned for a future release. For now, open the link a
        candidate shares, or the one their passport's QR code points to.
      </p>
    </div>
  );
}

// ---- Quick demo -------------------------------------------------------------

function QuickDemo({ onPick }) {
  const [samples, setSamples] = useState([]);

  useEffect(() => {
    getAllCredentials().then((list) => {
      const valid = list.find((c) => c.status === 'valid');
      const revoked = list.find((c) => c.status === 'revoked');
      setSamples([valid, revoked].filter(Boolean));
    });
  }, []);

  if (samples.length === 0) return null;

  return (
    <div className="mt-6 border border-border rounded-lg bg-card p-4">
      <p className="text-xs font-semibold text-ink-soft uppercase tracking-wide mb-1 flex items-center gap-1.5">
        <Sparkles size={12} aria-hidden="true" />
        Try a verification
      </p>
      <p className="text-xs text-ink-soft mb-3">
        Populate the Credential ID field with a real credential from this prototype's records.
      </p>
      <div className="flex flex-wrap gap-2">
        {samples.map((c) => (
          <button
            key={c.credentialId}
            onClick={() => onPick(c.credentialId)}
            className="flex items-center gap-1.5 text-xs font-mono border border-border rounded-md px-2.5 py-1.5 hover:bg-bg"
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${c.status === 'valid' ? 'bg-valid' : 'bg-revoked'}`}
              aria-hidden="true"
            />
            {c.credentialId}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---- Verifying state ------------------------------------------------------

function VerifyingCard() {
  return (
    <div className="bg-card border border-border rounded-lg card-shadow p-6 flex items-center gap-3">
      <Spinner size={18} className="text-teal" />
      <p className="text-sm text-ink-soft">Checking the registered credential record…</p>
    </div>
  );
}

// ---- How verification works ------------------------------------------------

const HOW_STEPS = [
  {
    n: '01',
    title: 'Issue',
    icon: FileText,
    body: 'The institution creates the credential and generates its certificate.',
  },
  {
    n: '02',
    title: 'Fingerprint',
    icon: Fingerprint,
    body: 'The certificate receives a SHA-256 Credential DNA — a unique fingerprint of its exact bytes.',
  },
  {
    n: '03',
    title: 'Register',
    icon: Database,
    body: 'The credential record stores that fingerprint alongside the credential details.',
  },
  {
    n: '04',
    title: 'Verify',
    icon: ScanEye,
    body: 'The submitted document is hashed again and compared against the registered fingerprint.',
  },
];

function ExplainerCollapsible() {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-6 border border-border rounded-lg bg-card overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-5 py-3.5 text-left"
        aria-expanded={open}
      >
        <span className="text-sm font-medium flex items-center gap-1.5">
          <ShieldCheck size={15} className="text-teal" aria-hidden="true" />
          How verification works
        </span>
        <ChevronDown
          size={16}
          className={`text-ink-soft transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>
      {open && (
        <div className="px-5 pb-5 border-t border-border pt-5">
          <div className="grid sm:grid-cols-4 gap-4 mb-5">
            {HOW_STEPS.map(({ n, title, icon: Icon, body }) => (
              <div key={n} className="text-center sm:text-left">
                <div className="flex items-center gap-2 justify-center sm:justify-start mb-1.5">
                  <span className="text-xs font-semibold text-teal">{n}</span>
                  <Icon size={14} className="text-teal" aria-hidden="true" />
                </div>
                <p className="text-sm font-medium text-ink mb-1">{title}</p>
                <p className="text-xs text-ink-soft leading-snug">{body}</p>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-ink-soft bg-bg border border-border rounded-md px-3 py-2.5">
            Current prototype: credential records and blockchain anchoring are simulated. SHA-256
            document fingerprinting is performed locally, for real, in your browser.
          </p>
        </div>
      )}
    </div>
  );
}
