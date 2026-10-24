import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ShieldCheck,
  ShieldAlert,
  Lock,
  Loader2,
  ChevronDown,
  Plus,
  ClipboardList,
  ClipboardCheck,
  Search,
  TrendingUp,
  Activity,
  Download,
  Copy,
  Check,
  X,
  Eye,
  Hash,
  Landmark,
  CalendarDays,
  FileText,
  Fingerprint,
  Database,
  ScanEye,
  Table2,
  Ban,
  AlertTriangle,
  ArrowRight,
  Layers,
  ShieldHalf,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import StatusBadge from '../components/StatusBadge';
import Spinner from '../components/Spinner';
import CredentialDNA, { shortenHash } from '../components/CredentialDNA';
import VerificationProofModal from '../components/VerificationProofModal';
import BatchIssuePanel from '../components/BatchIssuePanel';
import SecurityPanel from '../components/SecurityPanel';
import PlatformConsole from '../components/PlatformConsole';
import {
  issueCredential,
  getAllCredentials,
  revokeCredential,
  fakeCredentialId,
  fakeTxHash,
  adminLogin,
  adminLogout,
  currentInstitution,
  getSession,
  USE_BACKEND,
} from '../lib/api';
import { buildCertificateBytes, computeSha256Hex, downloadCertificatePdf } from '../lib/generateCertificatePdf';

const CREDENTIAL_TYPES = [
  'B.Tech in Computer Science & Engineering',
  'B.Tech in Information Technology',
  'B.Tech in Electronics & Communication Engineering',
  'M.Tech in Data Science',
  'M.Tech in Computer Science & Engineering',
];

export default function AdminConsole() {
  const { adminAuthed, setAdminAuthed } = useAuth();
  const role = getSession()?.role;
  const restored = ['admin', 'institution'].includes(role);
  if (!adminAuthed && !restored) return <AdminLogin />;
  // The platform admin approves institutions; universities manage their own credentials.
  if (USE_BACKEND && role === 'admin') {
    return (
      <PlatformConsole
        onSignOut={() => {
          adminLogout();
          setAdminAuthed(false);
        }}
      />
    );
  }
  return <AdminDashboard />;
}

// ---- Login -----------------------------------------------------------------

function AdminLogin() {
  const { setAdminAuthed } = useAuth();
  const { notify } = useToast();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!username.trim() || !password.trim()) {
      setError('Enter both a username and password.');
      return;
    }
    setLoading(true);
    try {
      await adminLogin(username.trim(), password);
      setAdminAuthed(true);
      notify('Signed in to the Credential Center.', 'success');
    } catch (err) {
      setError(err.message || 'Sign-in failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-8rem)] flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="bg-card border border-border rounded-lg card-shadow p-7">
          <div className="w-11 h-11 rounded-lg bg-teal-soft flex items-center justify-center mb-4">
            <Landmark size={22} className="text-teal" />
          </div>
          <p className="text-[11px] font-semibold tracking-[0.12em] text-teal uppercase mb-1">
            Management
          </p>
          <h1 className="text-lg font-semibold mb-1">Credential Center</h1>
          <p className="text-sm text-ink-soft mb-6">
            Sign in to issue, manage and verify the integrity of academic credentials.
            {USE_BACKEND
              ? ' Signed in with a JWT issued by the Chain of Record server.'
              : ' This is a mock login for the prototype — any non-empty username and password will work.'}
          </p>

          <form onSubmit={handleSubmit} className="space-y-3.5">
            <div>
              <label className="block text-xs font-medium text-ink-soft mb-1.5">
                {USE_BACKEND ? 'Registrar email or platform admin username' : 'Registrar username'}
              </label>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder={USE_BACKEND ? 'registrar@college.edu' : 'registrar.admin'}
                className="w-full rounded-md border border-border bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-teal/30 focus:border-teal"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-ink-soft mb-1.5">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full rounded-md border border-border bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-teal/30 focus:border-teal"
              />
            </div>
            {error && <p className="text-xs text-invalid">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 bg-teal text-white text-sm font-medium rounded-md py-2.5 hover:bg-teal/90 transition-colors disabled:opacity-60"
            >
              {loading ? <Spinner size={15} /> : <Lock size={15} />}
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
          {USE_BACKEND && (
            <p className="text-xs text-ink-soft mt-5 text-center">
              New institution?{' '}
              <Link to="/register/institution" className="text-teal font-medium hover:underline">
                Register to issue credentials
              </Link>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ---- Dashboard ---------------------------------------------------------------

function AdminDashboard() {
  const { setAdminAuthed } = useAuth();
  // Registry controls live in the platform console; in mock mode the demo shows them here.
  const isPlatformAdmin = !USE_BACKEND;
  const [tab, setTab] = useState('issue');
  const [credentials, setCredentials] = useState([]);
  const [loadingList, setLoadingList] = useState(true);
  const [detailCredential, setDetailCredential] = useState(null);

  const refreshList = () => {
    setLoadingList(true);
    getAllCredentials().then((data) => {
      setCredentials(data);
      setLoadingList(false);
    });
  };

  useEffect(() => {
    refreshList();
  }, []);

  const openDetail = (record) => {
    setTab('manage');
    setDetailCredential(record);
  };

  const stats = useMemo(() => {
    const total = credentials.length;
    const active = credentials.filter((c) => c.status === 'valid').length;
    const revoked = credentials.filter((c) => c.status === 'revoked').length;
    const thisYear = new Date().getFullYear();
    const issuedThisYear = credentials.filter(
      (c) => new Date(c.issueDate).getFullYear() === thisYear
    ).length;
    const integrityOk = credentials.filter((c) => c.status === 'valid').every((c) => Boolean(c.hash));
    return { total, active, revoked, issuedThisYear, integrityOk };
  }, [credentials]);

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-5 py-8 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.14em] text-teal uppercase mb-1">
            {currentInstitution().name}
          </p>
          <h1 className="text-xl font-semibold">Credential Center</h1>
          <p className="text-sm text-ink-soft mt-0.5">
            Issue, manage and verify the integrity of academic credentials.
          </p>
        </div>
        <button
          onClick={() => {
            adminLogout();
            setAdminAuthed(false);
          }}
          className="text-sm text-ink-soft hover:text-ink border border-border rounded-md px-3 py-1.5 shrink-0"
        >
          Sign out
        </button>
      </div>

      <DashboardOverview stats={stats} loading={loadingList} />

      <div className="grid lg:grid-cols-[2fr_1fr] gap-5">
        <QuickActions
          onIssue={() => setTab('issue')}
          onManage={() => setTab('manage')}
        />
        <InstitutionPanel />
      </div>

      <div className="flex flex-wrap gap-1 bg-white border border-border rounded-lg p-1 w-fit max-w-full">
        <TabButton active={tab === 'issue'} onClick={() => setTab('issue')} icon={Plus}>
          Issue Credential
        </TabButton>
        <TabButton active={tab === 'manage'} onClick={() => setTab('manage')} icon={Table2}>
          Manage Credentials
        </TabButton>
        {USE_BACKEND && (
          <>
            <TabButton active={tab === 'batch'} onClick={() => setTab('batch')} icon={Layers}>
              Batch Issue
            </TabButton>
            {isPlatformAdmin && (
              <TabButton active={tab === 'security'} onClick={() => setTab('security')} icon={ShieldHalf}>
                Security
              </TabButton>
            )}
          </>
        )}
      </div>

      {tab === 'issue' && (
        <IssuePanel credentials={credentials} onIssued={refreshList} onViewCredential={openDetail} />
      )}
      {tab === 'manage' && (
        <RegistryPanel
          credentials={credentials}
          loading={loadingList}
          onSelectCredential={setDetailCredential}
        />
      )}
      {tab === 'batch' && <BatchIssuePanel onIssued={refreshList} />}
      {tab === 'security' && <SecurityPanel />}

      <RecentActivity credentials={credentials} />

      {detailCredential && (
        <CredentialDetailPanel
          credentialId={detailCredential.credentialId}
          credentials={credentials}
          onClose={() => setDetailCredential(null)}
          onRevoked={refreshList}
        />
      )}
    </div>
  );
}

function TabButton({ active, onClick, icon: Icon, children }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-md text-sm font-medium transition-colors ${
        active ? 'bg-teal text-white' : 'text-ink-soft hover:text-ink'
      }`}
    >
      <Icon size={15} />
      {children}
    </button>
  );
}

// ---- Dashboard overview -------------------------------------------------------

function DashboardOverview({ stats, loading }) {
  const tiles = [
    { label: 'Total Credentials', value: stats.total, icon: ClipboardList },
    { label: 'Active', value: stats.active, icon: ShieldCheck },
    { label: 'Revoked', value: stats.revoked, icon: ShieldAlert },
    { label: 'Issued This Year', value: stats.issuedThisYear, icon: TrendingUp },
  ];

  return (
    <div className="bg-card border border-border rounded-lg card-shadow p-5 sm:p-6">
      {loading ? (
        <div className="flex justify-center py-6 text-ink-soft">
          <Spinner size={20} />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5 mb-5">
            {tiles.map(({ label, value, icon: Icon }) => (
              <div key={label} className="flex items-center gap-3">
                <span className="w-9 h-9 rounded-lg bg-teal-soft text-teal flex items-center justify-center shrink-0">
                  <Icon size={16} aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <p className="text-lg font-semibold leading-tight">{value}</p>
                  <p className="text-xs text-ink-soft leading-tight truncate">{label}</p>
                </div>
              </div>
            ))}
          </div>
          <div
            className={`flex items-center gap-2 text-xs font-medium rounded-md px-3 py-2 ${
              stats.integrityOk ? 'bg-valid-soft text-valid' : 'bg-revoked-soft text-revoked'
            }`}
          >
            {stats.integrityOk ? (
              <ShieldCheck size={14} aria-hidden="true" />
            ) : (
              <ShieldAlert size={14} aria-hidden="true" />
            )}
            <span>Credential integrity:</span>
            {stats.integrityOk
              ? 'All active credentials have registered fingerprints.'
              : 'Attention required — one or more active credentials are missing a fingerprint.'}
          </div>
        </>
      )}
    </div>
  );
}

function QuickActions({ onIssue, onManage }) {
  return (
    <div className="bg-card border border-border rounded-lg card-shadow p-5 sm:p-6">
      <p className="text-xs font-semibold text-ink-soft uppercase tracking-wide mb-3">
        Quick actions
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          onClick={onIssue}
          className="flex-1 min-w-[160px] flex items-center justify-center gap-1.5 text-sm font-medium bg-teal text-white rounded-md px-4 py-2.5 hover:bg-teal/90"
        >
          <Plus size={15} aria-hidden="true" />
          Issue Credential
        </button>
        <button
          onClick={onManage}
          className="flex-1 min-w-[160px] flex items-center justify-center gap-1.5 text-sm font-medium border border-border rounded-md px-4 py-2.5 hover:bg-bg"
        >
          <Table2 size={15} aria-hidden="true" />
          Manage Credentials
        </button>
        <Link
          to="/verify"
          className="flex-1 min-w-[160px] flex items-center justify-center gap-1.5 text-sm font-medium border border-border rounded-md px-4 py-2.5 hover:bg-bg"
        >
          <Search size={15} aria-hidden="true" />
          View Verification
        </Link>
      </div>
    </div>
  );
}

function InstitutionPanel() {
  return (
    <div className="bg-card border border-border rounded-lg card-shadow p-5 sm:p-6">
      <p className="text-xs font-semibold text-ink-soft uppercase tracking-wide mb-3">Institution</p>
      <div className="flex items-center gap-2.5 mb-2">
        <span className="w-9 h-9 rounded-lg bg-teal-soft text-teal flex items-center justify-center shrink-0">
          <Landmark size={16} aria-hidden="true" />
        </span>
        <p className="text-sm font-semibold">{currentInstitution().name}</p>
      </div>
      <div className="space-y-1 text-xs text-ink-soft">
        <p className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-valid" aria-hidden="true" />
          Status: Active
        </p>
        <p className="flex items-center gap-1.5">
          <ShieldCheck size={11} aria-hidden="true" />
          Credential issuance: Enabled
        </p>
      </div>
      <p className="text-[10px] text-ink-soft/70 mt-3 border-t border-border pt-2.5">
        Prototype — not an official integration with {currentInstitution().name}.
      </p>
    </div>
  );
}

// ---- Issue credential wizard ---------------------------------------------------

const EMPTY_FORM = {
  studentName: '',
  studentId: '',
  studentEmail: '',
  credentialType: CREDENTIAL_TYPES[0],
  issueDate: new Date().toISOString().slice(0, 10),
};

const WIZARD_STEPS = [
  { key: 'student', label: 'Student Details' },
  { key: 'credential', label: 'Credential Details' },
  { key: 'review', label: 'Review' },
  { key: 'issue', label: 'Issue Credential' },
];

function findDuplicate(credentials, form) {
  return (
    credentials.find(
      (c) =>
        c.studentId.trim().toLowerCase() === form.studentId.trim().toLowerCase() &&
        c.credentialType === form.credentialType &&
        c.issueDate === form.issueDate
    ) || null
  );
}

function IssuePanel({ credentials, onIssued, onViewCredential }) {
  const { notify } = useToast();
  const [form, setForm] = useState(EMPTY_FORM);
  const [step, setStep] = useState('student');
  const [candidate, setCandidate] = useState(null); // { credentialId, txHash }
  const [previewHash, setPreviewHash] = useState(null);
  const [hashLoading, setHashLoading] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const [result, setResult] = useState(null);
  const [dismissedDuplicate, setDismissedDuplicate] = useState(false);

  const update = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const stepIndex = WIZARD_STEPS.findIndex((s) => s.key === (step === 'success' ? 'issue' : step));
  const duplicate = useMemo(() => findDuplicate(credentials, form), [credentials, form]);

  // Generate the candidate credential ID / ledger reference exactly once per
  // review pass, then compute the SAME certificate bytes + SHA-256 that
  // issueCredential() will use — see mockApi.js for why this must match.
  useEffect(() => {
    if (step !== 'review' || candidate) return;
    setCandidate({ credentialId: fakeCredentialId(), txHash: fakeTxHash() });
  }, [step, candidate]);

  useEffect(() => {
    if (!candidate) return;
    let cancelled = false;
    setHashLoading(true);
    (async () => {
      const fields = {
        credentialId: candidate.credentialId,
        studentName: form.studentName,
        studentId: form.studentId,
        credentialType: form.credentialType,
        issueDate: form.issueDate,
        issuer: currentInstitution().name,
        txHash: candidate.txHash,
      };
      const bytes = buildCertificateBytes(fields);
      const hash = await computeSha256Hex(bytes);
      if (!cancelled) {
        setPreviewHash(hash);
        setHashLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidate]);

  const resetAll = () => {
    setForm(EMPTY_FORM);
    setStep('student');
    setCandidate(null);
    setPreviewHash(null);
    setResult(null);
    setDismissedDuplicate(false);
  };

  const goToReview = () => {
    setDismissedDuplicate(false);
    setStep('review');
  };

  const handleConfirmIssue = async () => {
    if (!candidate) return;
    setIssuing(true);
    try {
      const res = await issueCredential({
        studentName: form.studentName,
        studentId: form.studentId,
        credentialType: form.credentialType,
        issueDate: form.issueDate,
        credentialId: candidate.credentialId,
        txHash: candidate.txHash,
        ...(USE_BACKEND && form.studentEmail.trim() ? { studentEmail: form.studentEmail.trim() } : {}),
      });
      setResult(res);
      setStep('success');
      notify(`Credential ${res.credentialId} issued.`, 'success');
      onIssued();
    } catch (err) {
      notify(err.message || 'Failed to issue credential. Please try again.', 'error');
    } finally {
      setIssuing(false);
    }
  };

  if (step === 'success' && result) {
    return (
      <SuccessPanel
        result={result}
        onViewCredential={() => onViewCredential(result.record)}
        onIssueAnother={resetAll}
      />
    );
  }

  return (
    <div className="bg-card border border-border rounded-lg card-shadow p-6 sm:p-7 max-w-2xl">
      <WizardSteps steps={WIZARD_STEPS} activeIndex={stepIndex} />

      {step === 'student' && (
        <StepStudentDetails
          form={form}
          update={update}
          onContinue={() => setStep('credential')}
        />
      )}

      {step === 'credential' && (
        <StepCredentialDetails
          form={form}
          update={update}
          onBack={() => setStep('student')}
          onContinue={goToReview}
        />
      )}

      {step === 'review' && (
        <StepReview
          form={form}
          previewHash={previewHash}
          hashLoading={hashLoading}
          issuing={issuing}
          duplicate={duplicate}
          dismissedDuplicate={dismissedDuplicate}
          onDismissDuplicate={() => setDismissedDuplicate(true)}
          onBack={() => setStep('credential')}
          onConfirm={handleConfirmIssue}
        />
      )}
    </div>
  );
}

function WizardSteps({ steps, activeIndex }) {
  return (
    <div className="flex items-center gap-1.5 mb-6 flex-wrap" aria-label="Issuance progress">
      {steps.map((s, i) => (
        <div key={s.key} className="flex items-center gap-1.5">
          <span
            className={`flex items-center gap-1.5 text-xs font-medium rounded-full px-2.5 py-1 ${
              i < activeIndex
                ? 'bg-valid-soft text-valid'
                : i === activeIndex
                ? 'bg-teal text-white'
                : 'bg-bg text-ink-soft border border-border'
            }`}
          >
            {i < activeIndex ? <Check size={11} aria-hidden="true" /> : <span>{i + 1}</span>}
            {s.label}
          </span>
          {i < steps.length - 1 && (
            <ArrowRight size={12} className="text-ink-soft shrink-0" aria-hidden="true" />
          )}
        </div>
      ))}
    </div>
  );
}

function StepStudentDetails({ form, update, onContinue }) {
  const canContinue = form.studentName.trim() && form.studentId.trim();
  return (
    <div>
      <h2 className="text-lg font-semibold mb-1">Student details</h2>
      <p className="text-sm text-ink-soft mb-5">Who this credential is being issued to.</p>

      <div className="space-y-4 mb-5">
        <div>
          <label className="block text-xs font-medium text-ink-soft mb-1.5">Student name</label>
          <input
            value={form.studentName}
            onChange={update('studentName')}
            placeholder="e.g. Divya Menon"
            className="w-full rounded-md border border-border bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-teal/30 focus:border-teal"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-ink-soft mb-1.5">Student ID</label>
          <input
            value={form.studentId}
            onChange={update('studentId')}
            placeholder="e.g. RGIT22CS051"
            className="w-full rounded-md border border-border bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-teal/30 focus:border-teal"
          />
        </div>
        {USE_BACKEND && (
          <div>
            <label className="block text-xs font-medium text-ink-soft mb-1.5">
              Student personal email <span className="font-normal">(optional)</span>
            </label>
            <input
              type="email"
              value={form.studentEmail}
              onChange={update('studentEmail')}
              placeholder="e.g. divya.menon@gmail.com"
              className="w-full rounded-md border border-border bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-teal/30 focus:border-teal"
            />
            <p className="text-[11px] text-ink-soft mt-1">
              Lets the student create their own login on the Student portal with this email.
            </p>
          </div>
        )}
      </div>

      <div className="border border-border rounded-md p-3.5 bg-bg/50 mb-6">
        <p className="text-[11px] font-medium text-ink-soft uppercase tracking-wide mb-1.5">
          Issuer
        </p>
        <div className="flex items-center gap-2">
          <Landmark size={15} className="text-teal shrink-0" aria-hidden="true" />
          <p className="text-sm font-medium">{currentInstitution().name}</p>
        </div>
        <p className="text-xs text-valid flex items-center gap-1 mt-1.5">
          <Check size={11} aria-hidden="true" />
          Registered institution
        </p>
      </div>

      <button
        onClick={onContinue}
        disabled={!canContinue}
        className="flex items-center gap-1.5 bg-teal text-white text-sm font-medium rounded-md px-4 py-2.5 hover:bg-teal/90 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        Continue
        <ArrowRight size={14} aria-hidden="true" />
      </button>
    </div>
  );
}

function StepCredentialDetails({ form, update, onBack, onContinue }) {
  const canContinue = Boolean(form.credentialType && form.issueDate);
  return (
    <div>
      <h2 className="text-lg font-semibold mb-1">Credential details</h2>
      <p className="text-sm text-ink-soft mb-5">What is being issued, and when.</p>

      <div className="space-y-4 mb-6">
        <div>
          <label className="block text-xs font-medium text-ink-soft mb-1.5">
            Degree / credential type
          </label>
          <select
            value={form.credentialType}
            onChange={update('credentialType')}
            className="w-full rounded-md border border-border bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-teal/30 focus:border-teal"
          >
            {CREDENTIAL_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-ink-soft mb-1.5">Issue date</label>
          <input
            type="date"
            value={form.issueDate}
            onChange={update('issueDate')}
            className="w-full rounded-md border border-border bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-teal/30 focus:border-teal"
          />
        </div>
      </div>

      <div className="flex gap-2">
        <button
          onClick={onBack}
          className="text-sm font-medium text-ink-soft border border-border rounded-md px-4 py-2.5 hover:bg-bg"
        >
          Back
        </button>
        <button
          onClick={onContinue}
          disabled={!canContinue}
          className="flex items-center gap-1.5 bg-teal text-white text-sm font-medium rounded-md px-4 py-2.5 hover:bg-teal/90 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Continue to review
          <ArrowRight size={14} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

function StepReview({
  form,
  previewHash,
  hashLoading,
  issuing,
  duplicate,
  dismissedDuplicate,
  onDismissDuplicate,
  onBack,
  onConfirm,
}) {
  const showDuplicateWarning = duplicate && !dismissedDuplicate;

  return (
    <div>
      <h2 className="text-lg font-semibold mb-1">Review credential</h2>
      <p className="text-sm text-ink-soft mb-5">
        Confirm the details below before issuing. This credential is not created until you
        confirm.
      </p>

      {showDuplicateWarning && (
        <div className="border border-revoked/30 bg-revoked-soft rounded-md p-3.5 mb-5">
          <p className="text-xs font-semibold text-revoked flex items-center gap-1.5 mb-1">
            <AlertTriangle size={13} aria-hidden="true" />
            Similar credential already exists
          </p>
          <p className="text-xs text-ink-soft mb-2.5">
            {duplicate.studentName} already has a "{duplicate.credentialType}" credential dated{' '}
            {duplicate.issueDate} ({duplicate.status === 'revoked' ? 'revoked' : 'active'},{' '}
            {duplicate.credentialId}).
          </p>
          <button
            onClick={onDismissDuplicate}
            className="text-xs font-medium text-revoked border border-revoked/40 rounded-md px-3 py-1.5 hover:bg-white"
          >
            Continue anyway
          </button>
        </div>
      )}

      <div className="border border-border rounded-lg overflow-hidden mb-5">
        <div className="bg-bg px-4 py-2.5 text-center">
          <p className="text-[11px] font-semibold tracking-[0.12em] text-teal uppercase">
            {currentInstitution().name}
          </p>
        </div>
        <div className="p-4 space-y-3">
          <ReviewRow label="Student name" value={form.studentName} />
          <ReviewRow label="Student ID" value={form.studentId} mono />
          <ReviewRow label="Credential" value={form.credentialType} />
          <ReviewRow label="Issue date" value={form.issueDate} />
        </div>
        <div className="border-t border-border p-4">
          <p className="text-xs font-semibold mb-2">Document integrity</p>
          <p className="text-xs text-ink-soft mb-3">
            A cryptographic fingerprint will be generated for this credential from its exact
            certificate contents.
          </p>
          {hashLoading || !previewHash ? (
            <div className="flex items-center gap-2 text-xs text-ink-soft">
              <Loader2 size={13} className="animate-spin" aria-hidden="true" />
              Generating Credential DNA…
            </div>
          ) : (
            <CredentialDNA hash={previewHash} />
          )}
        </div>
      </div>

      <div className="flex gap-2">
        <button
          onClick={onBack}
          disabled={issuing}
          className="text-sm font-medium text-ink-soft border border-border rounded-md px-4 py-2.5 hover:bg-bg disabled:opacity-60"
        >
          Back
        </button>
        <button
          onClick={onConfirm}
          disabled={issuing || hashLoading || !previewHash}
          className="flex items-center gap-1.5 bg-teal text-white text-sm font-medium rounded-md px-4 py-2.5 hover:bg-teal/90 disabled:opacity-50"
        >
          {issuing ? <Spinner size={14} /> : <ClipboardCheck size={15} aria-hidden="true" />}
          {issuing ? 'Issuing…' : 'Confirm & Issue Credential'}
        </button>
      </div>
    </div>
  );
}

function ReviewRow({ label, value, mono }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <p className="text-xs text-ink-soft shrink-0">{label}</p>
      <p className={`text-sm text-right ${mono ? 'font-mono' : 'font-medium'}`}>{value}</p>
    </div>
  );
}

function SuccessPanel({ result, onViewCredential, onIssueAnother }) {
  const { notify } = useToast();
  const [copied, setCopied] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const handleCopyId = async () => {
    try {
      await navigator.clipboard.writeText(result.credentialId);
      setCopied(true);
      notify('Credential ID copied.', 'success');
      setTimeout(() => setCopied(false), 1800);
    } catch {
      notify('Could not copy — clipboard unavailable.', 'error');
    }
  };

  const handleDownload = () => {
    downloadCertificatePdf(result.record);
    notify('Certificate PDF downloaded.', 'info');
  };

  return (
    <div className="bg-card border border-border rounded-lg card-shadow p-7 max-w-xl">
      <div className="w-11 h-11 rounded-lg bg-valid-soft flex items-center justify-center mb-4">
        <ShieldCheck size={22} className="text-valid" />
      </div>
      <h2 className="text-lg font-semibold mb-1">Credential issued</h2>
      <p className="text-sm text-ink-soft mb-5">Credential successfully registered.</p>

      <div className="space-y-2.5 mb-5">
        <ReviewRow label="Student" value={result.record.studentName} />
        <ReviewRow label="Credential" value={result.record.credentialType} />
        <ReviewRow label="Credential ID" value={result.credentialId} mono />
        <ReviewRow label="Status" value="ACTIVE" />
        <ReviewRow label="Issuer" value={currentInstitution().name} />
      </div>

      <div className="border border-border rounded-md p-3.5 mb-5 bg-bg/50">
        <CredentialDNA hash={result.hash} />
      </div>

      <div className="mb-5">
        <button
          onClick={() => setDetailsOpen((o) => !o)}
          className="w-full flex items-center justify-between text-xs text-ink-soft hover:text-ink py-1"
        >
          <span className="flex items-center gap-1.5">
            <Hash size={12} aria-hidden="true" />
            Technical details
          </span>
          <ChevronDown
            size={13}
            className={`transition-transform ${detailsOpen ? 'rotate-180' : ''}`}
            aria-hidden="true"
          />
        </button>
        {detailsOpen && (
          <p className="text-[11px] text-ink-soft mt-1.5 font-mono break-all">
            Prototype ledger reference (simulated): {result.txHash}
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={onViewCredential}
          className="flex items-center gap-1.5 text-sm font-medium bg-teal text-white rounded-md px-4 py-2 hover:bg-teal/90"
        >
          <Eye size={14} aria-hidden="true" />
          View Credential
        </button>
        <button
          onClick={handleDownload}
          className="flex items-center gap-1.5 text-sm font-medium border border-border rounded-md px-4 py-2 hover:bg-bg"
        >
          <Download size={14} aria-hidden="true" />
          Download Certificate
        </button>
        <button
          onClick={handleCopyId}
          className="flex items-center gap-1.5 text-sm font-medium border border-border rounded-md px-4 py-2 hover:bg-bg"
        >
          {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
          {copied ? 'Copied' : 'Copy Credential ID'}
        </button>
        <button
          onClick={onIssueAnother}
          className="flex items-center gap-1.5 text-sm font-medium text-ink-soft border border-border rounded-md px-4 py-2 hover:bg-bg"
        >
          Done
        </button>
      </div>
    </div>
  );
}

// ---- Registry --------------------------------------------------------------

function RegistryPanel({ credentials, loading, onSelectCredential }) {
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');

  const types = useMemo(
    () => [...new Set(credentials.map((c) => c.credentialType))].sort(),
    [credentials]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return credentials.filter((c) => {
      if (statusFilter !== 'all' && c.status !== statusFilter) return false;
      if (typeFilter !== 'all' && c.credentialType !== typeFilter) return false;
      if (!q) return true;
      return (
        c.studentName.toLowerCase().includes(q) ||
        c.studentId.toLowerCase().includes(q) ||
        c.credentialId.toLowerCase().includes(q) ||
        c.credentialType.toLowerCase().includes(q)
      );
    });
  }, [credentials, query, statusFilter, typeFilter]);

  return (
    <div className="bg-card border border-border rounded-lg card-shadow overflow-hidden">
      <div className="px-5 py-4 border-b border-border flex flex-wrap items-center gap-3">
        <h2 className="text-sm font-semibold shrink-0">Credential registry</h2>
        <div className="flex-1 min-w-[180px] relative">
          <Search
            size={13}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-soft"
            aria-hidden="true"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, student ID, credential ID, or type…"
            aria-label="Search credentials"
            className="w-full rounded-md border border-border bg-white pl-8 pr-3 py-1.5 text-xs outline-none focus:ring-2 focus:ring-teal/30 focus:border-teal"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          aria-label="Filter by status"
          className="rounded-md border border-border bg-white px-2.5 py-1.5 text-xs outline-none focus:ring-2 focus:ring-teal/30"
        >
          <option value="all">All statuses</option>
          <option value="valid">Active</option>
          <option value="revoked">Revoked</option>
        </select>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          aria-label="Filter by credential type"
          className="rounded-md border border-border bg-white px-2.5 py-1.5 text-xs outline-none focus:ring-2 focus:ring-teal/30 max-w-[200px]"
        >
          <option value="all">All credential types</option>
          {types.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <span className="text-xs text-ink-soft shrink-0">
          {filtered.length} of {credentials.length}
        </span>
      </div>

      {loading ? (
        <div className="p-10 flex justify-center text-ink-soft">
          <Spinner size={20} />
        </div>
      ) : filtered.length === 0 ? (
        <div className="p-10 text-center text-sm text-ink-soft">No matching credentials.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-ink-soft border-b border-border">
                <th className="px-5 py-2.5 font-medium">Credential</th>
                <th className="px-5 py-2.5 font-medium">Student</th>
                <th className="px-5 py-2.5 font-medium">Issued</th>
                <th className="px-5 py-2.5 font-medium">Status</th>
                <th className="px-5 py-2.5 font-medium">Credential DNA</th>
                <th className="px-5 py-2.5 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.credentialId} className="border-b border-border last:border-0 hover:bg-bg/60">
                  <td className="px-5 py-3">
                    <p className="font-medium leading-tight">{c.credentialType}</p>
                    <p className="text-xs text-ink-soft font-mono leading-tight mt-0.5">
                      {c.credentialId}
                    </p>
                  </td>
                  <td className="px-5 py-3">
                    <p className="font-medium leading-tight">{c.studentName}</p>
                    <p className="text-xs text-ink-soft leading-tight mt-0.5">{c.studentId}</p>
                  </td>
                  <td className="px-5 py-3 text-ink-soft whitespace-nowrap">{c.issueDate}</td>
                  <td className="px-5 py-3">
                    <StatusBadge status={c.status} size="sm" />
                  </td>
                  <td className="px-5 py-3 font-mono text-xs text-ink-soft">
                    {shortenHash(c.hash)}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <button
                      onClick={() => onSelectCredential(c)}
                      className="inline-flex items-center gap-1 text-xs font-medium text-teal border border-teal/30 rounded-md px-2.5 py-1.5 hover:bg-teal-soft/60"
                    >
                      <Eye size={12} aria-hidden="true" />
                      View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---- Credential detail panel -------------------------------------------------

function CredentialDetailPanel({ credentialId, credentials, onClose, onRevoked }) {
  const { notify } = useToast();
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [proofOpen, setProofOpen] = useState(false);
  const closeButtonRef = useRef(null);

  const credential = credentials.find((c) => c.credentialId === credentialId) || null;

  useEffect(() => {
    closeButtonRef.current?.focus();
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  if (!credential) return null;
  const revoked = credential.status === 'revoked';

  const handleDownload = () => {
    downloadCertificatePdf(credential);
    notify('Certificate PDF downloaded.', 'info');
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 px-4 py-8 overflow-y-auto"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Credential detail for ${credential.credentialId}`}
    >
      <div
        className="bg-card border border-border rounded-lg card-shadow w-full max-w-lg p-6 animate-modal-in my-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-base font-semibold">{credential.credentialType}</h2>
            <p className="text-xs text-ink-soft mt-0.5">{credential.credentialId}</p>
          </div>
          <button
            ref={closeButtonRef}
            onClick={onClose}
            className="text-ink-soft hover:text-ink shrink-0"
            aria-label="Close credential details"
          >
            <X size={18} />
          </button>
        </div>

        <div className="mb-2">
          <StatusBadge status={credential.status} />
        </div>

        <div className="space-y-2.5 border border-border rounded-md p-4 bg-bg/50 mb-4">
          <ReviewRow label="Student" value={credential.studentName} />
          <ReviewRow label="Student ID" value={credential.studentId} mono />
          <ReviewRow label="Institution" value={credential.issuer} />
          <ReviewRow label="Issue date" value={credential.issueDate} />
        </div>

        {revoked && credential.revocation && (
          <div className="bg-revoked-soft text-revoked text-xs rounded-md px-3 py-2.5 mb-4">
            <p className="font-medium mb-0.5">Revoked {credential.revocation.date}</p>
            <p>{credential.revocation.reason}</p>
          </div>
        )}

        <div className="border border-border rounded-md p-4 mb-5">
          <p className="text-xs font-semibold mb-2">Credential DNA</p>
          <CredentialDNA hash={credential.hash} />
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={handleDownload}
            className="flex items-center gap-1.5 text-sm font-medium bg-teal text-white rounded-md px-3.5 py-2 hover:bg-teal/90"
          >
            <Download size={14} aria-hidden="true" />
            Download certificate
          </button>
          <button
            onClick={() => setProofOpen(true)}
            className="flex items-center gap-1.5 text-sm font-medium border border-border rounded-md px-3.5 py-2 hover:bg-bg"
          >
            <ShieldCheck size={14} aria-hidden="true" />
            Verify credential
          </button>
          {!revoked && (
            <button
              onClick={() => setRevokeOpen(true)}
              className="flex items-center gap-1.5 text-sm font-medium text-invalid border border-invalid/30 rounded-md px-3.5 py-2 hover:bg-invalid-soft"
            >
              <Ban size={14} aria-hidden="true" />
              Revoke credential
            </button>
          )}
        </div>
      </div>

      {proofOpen && (
        <VerificationProofModal credential={credential} onClose={() => setProofOpen(false)} />
      )}
      {revokeOpen && (
        <RevokeModal
          credential={credential}
          onClose={() => setRevokeOpen(false)}
          onRevoked={() => {
            setRevokeOpen(false);
            onRevoked();
          }}
        />
      )}
    </div>
  );
}

// ---- Revoke modal ------------------------------------------------------------

function RevokeModal({ credential, onClose, onRevoked }) {
  const { notify } = useToast();
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [revokedRecord, setRevokedRecord] = useState(null);
  const closeButtonRef = useRef(null);

  useEffect(() => {
    closeButtonRef.current?.focus();
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const handleConfirm = async () => {
    if (!reason.trim()) return;
    setLoading(true);
    try {
      const updated = await revokeCredential(credential.credentialId, reason);
      setRevokedRecord(updated);
      notify(`Credential ${credential.credentialId} has been revoked.`, 'warning');
    } catch (err) {
      notify(err.message || 'Failed to revoke credential. Please try again.', 'error');
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/40 px-4" onClick={onClose}>
      <div
        className="bg-card border border-border rounded-lg card-shadow w-full max-w-md p-6 animate-modal-in"
        onClick={(e) => e.stopPropagation()}
      >
        {revokedRecord ? (
          <>
            <div className="w-10 h-10 rounded-lg bg-revoked-soft flex items-center justify-center mb-3">
              <ShieldAlert size={18} className="text-revoked" />
            </div>
            <h3 className="text-base font-semibold mb-1">Credential revoked</h3>
            <p className="text-sm text-ink-soft mb-4">
              <span className="font-medium text-ink">{credential.credentialId}</span> is no longer
              active. Future verification attempts will show it as revoked.
            </p>
            <div className="space-y-2 border border-border rounded-md p-3.5 bg-bg/50 mb-5">
              <ReviewRow label="Revocation date" value={revokedRecord.revocation.date} />
              <div>
                <p className="text-xs text-ink-soft mb-0.5">Reason</p>
                <p className="text-sm">{revokedRecord.revocation.reason}</p>
              </div>
            </div>
            <button
              onClick={() => {
                onRevoked();
              }}
              className="w-full text-sm font-medium bg-teal text-white rounded-md px-4 py-2 hover:bg-teal/90"
            >
              Done
            </button>
          </>
        ) : (
          <>
            <div className="w-10 h-10 rounded-lg bg-revoked-soft flex items-center justify-center mb-3">
              <Ban size={18} className="text-revoked" />
            </div>
            <h3 className="text-base font-semibold mb-1">Revoke credential</h3>
            <div className="text-sm text-ink-soft mb-3 space-y-0.5">
              <p>
                Credential: <span className="font-medium text-ink">{credential.credentialType}</span>
              </p>
              <p>
                Student: <span className="font-medium text-ink">{credential.studentName}</span>
              </p>
            </div>
            <p className="text-xs text-revoked bg-revoked-soft rounded-md px-3 py-2 mb-4">
              Revoking this credential will cause future verification attempts to show that it is
              no longer active. This cannot be undone in this prototype.
            </p>
            <label className="block text-xs font-medium text-ink-soft mb-1.5">
              Revocation reason <span className="text-invalid">*</span>
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="e.g. Issued in error, academic integrity violation, degree rescinded…"
              className="w-full rounded-md border border-border bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-revoked/30 focus:border-revoked mb-5 resize-none"
            />
            <div className="flex justify-end gap-2">
              <button
                ref={closeButtonRef}
                onClick={onClose}
                disabled={loading}
                className="text-sm font-medium text-ink-soft border border-border rounded-md px-4 py-2 hover:bg-bg"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirm}
                disabled={loading || !reason.trim()}
                className="flex items-center gap-1.5 text-sm font-medium bg-revoked text-white rounded-md px-4 py-2 hover:bg-revoked/90 disabled:opacity-60"
              >
                {loading && <Spinner size={13} />}
                {loading ? 'Revoking…' : 'Revoke Credential'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ---- Recent activity ----------------------------------------------------------

function relativeDateLabel(dateStr) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(dateStr);
  d.setHours(0, 0, 0, 0);
  const diffDays = Math.round((today - d) / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function buildRecentActivity(credentials) {
  const events = [];
  for (const c of credentials) {
    events.push({
      key: `issued-${c.credentialId}`,
      type: 'issued',
      date: c.issueDate,
      studentName: c.studentName,
      credentialType: c.credentialType,
    });
    if (c.status === 'revoked' && c.revocation?.date) {
      events.push({
        key: `revoked-${c.credentialId}`,
        type: 'revoked',
        date: c.revocation.date,
        studentName: c.studentName,
        credentialType: c.credentialType,
      });
    }
  }
  return events.sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 8);
}

function RecentActivity({ credentials }) {
  const events = useMemo(() => buildRecentActivity(credentials), [credentials]);

  return (
    <div>
      <h2 className="text-base font-semibold mb-0.5 flex items-center gap-1.5">
        <Activity size={15} aria-hidden="true" />
        Recent activity
      </h2>
      <p className="text-xs text-ink-soft mb-3.5">
        Derived from credential issue and revocation dates — not a complete audit log.
      </p>
      {events.length === 0 ? (
        <div className="bg-card border border-border rounded-lg p-6 text-center text-sm text-ink-soft">
          No activity yet.
        </div>
      ) : (
        <div className="bg-card border border-border rounded-lg card-shadow divide-y divide-border">
          {events.map((e) => (
            <div key={e.key} className="px-5 py-3 flex items-center gap-3">
              <span
                className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
                  e.type === 'issued' ? 'bg-valid-soft text-valid' : 'bg-revoked-soft text-revoked'
                }`}
              >
                {e.type === 'issued' ? (
                  <Check size={13} aria-hidden="true" />
                ) : (
                  <ShieldAlert size={13} aria-hidden="true" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm">
                  {e.type === 'issued' ? 'Credential issued' : 'Credential revoked'} —{' '}
                  <span className="font-medium">{e.studentName}</span>
                </p>
                <p className="text-xs text-ink-soft truncate">{e.credentialType}</p>
              </div>
              <span className="text-xs text-ink-soft shrink-0 flex items-center gap-1">
                <CalendarDays size={11} aria-hidden="true" />
                {relativeDateLabel(e.date)}
              </span>
            </div>
          ))}
        </div>
      )}
      <HowIssuanceWorks />
    </div>
  );
}

// ---- How issuance works ---------------------------------------------------

const ISSUANCE_STEPS = [
  { icon: Landmark, title: 'Institution', body: `${currentInstitution().name} initiates issuance.` },
  { icon: FileText, title: 'Create credential', body: 'Student and credential details are recorded.' },
  { icon: ClipboardList, title: 'Generate certificate', body: 'A deterministic certificate document is generated.' },
  { icon: Fingerprint, title: 'Calculate Credential DNA', body: 'A SHA-256 fingerprint of the certificate is computed.' },
  { icon: Database, title: 'Register credential', body: 'The credential record stores the fingerprint.' },
  { icon: ScanEye, title: 'Deliver to student', body: 'The student can view, download and share the credential.' },
];

function HowIssuanceWorks() {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-4 border border-border rounded-lg bg-card overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-5 py-3.5 text-left"
        aria-expanded={open}
      >
        <span className="text-sm font-medium">How issuance works</span>
        <ChevronDown
          size={16}
          className={`text-ink-soft transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>
      {open && (
        <div className="px-5 pb-5 border-t border-border pt-4">
          <div className="grid sm:grid-cols-3 gap-4 mb-4">
            {ISSUANCE_STEPS.map(({ icon: Icon, title, body }) => (
              <div key={title} className="flex items-start gap-2.5">
                <span className="w-7 h-7 rounded-lg bg-teal-soft text-teal flex items-center justify-center shrink-0">
                  <Icon size={13} aria-hidden="true" />
                </span>
                <div>
                  <p className="text-xs font-medium text-ink">{title}</p>
                  <p className="text-xs text-ink-soft leading-snug mt-0.5">{body}</p>
                </div>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-ink-soft bg-bg border border-border rounded-md px-3 py-2.5">
            Current prototype: blockchain anchoring is simulated. Document integrity uses SHA-256
            fingerprint verification, performed locally.
          </p>
        </div>
      )}
    </div>
  );
}
