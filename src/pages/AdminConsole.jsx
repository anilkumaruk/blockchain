import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import {
  ShieldCheck,
  Lock,
  FileText,
  Hash,
  Link2,
  CheckCircle2,
  Loader2,
  Table2,
  Ban,
  RotateCcw,
  User,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import StatusBadge from '../components/StatusBadge';
import HashChip from '../components/HashChip';
import Spinner from '../components/Spinner';
import {
  issueCredential,
  getAllCredentials,
  revokeCredential,
} from '../lib/mockApi';

const CREDENTIAL_TYPES = [
  'B.Tech in Computer Science & Engineering',
  'B.Tech in Information Technology',
  'B.Tech in Electronics & Communication Engineering',
  'M.Tech in Data Science',
  'M.Tech in Computer Science & Engineering',
];

export default function AdminConsole() {
  const { adminAuthed } = useAuth();
  return adminAuthed ? <AdminDashboard /> : <AdminLogin />;
}

function AdminLogin() {
  const { setAdminAuthed } = useAuth();
  const { notify } = useToast();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    setError('');
    if (!username.trim() || !password.trim()) {
      setError('Enter both a username and password.');
      return;
    }
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      setAdminAuthed(true);
      notify('Signed in to Admin Console.', 'success');
    }, 550);
  };

  return (
    <div className="min-h-[calc(100vh-8rem)] flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="bg-card border border-border rounded-lg card-shadow p-7">
          <div className="w-11 h-11 rounded-lg bg-teal-soft flex items-center justify-center mb-4">
            <ShieldCheck size={22} className="text-teal" />
          </div>
          <h1 className="text-lg font-semibold mb-1">Admin Console</h1>
          <p className="text-sm text-ink-soft mb-6">
            Sign in to issue and manage academic credentials. This is a mock login for the
            prototype — any non-empty username and password will work.
          </p>

          <form onSubmit={handleSubmit} className="space-y-3.5">
            <div>
              <label className="block text-xs font-medium text-ink-soft mb-1.5">
                Username
              </label>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="registrar.admin"
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
        </div>
      </div>
    </div>
  );
}

function AdminDashboard() {
  const { setAdminAuthed } = useAuth();
  const [tab, setTab] = useState('issue');
  const [credentials, setCredentials] = useState([]);
  const [loadingList, setLoadingList] = useState(true);

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

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-5 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold">Admin Console</h1>
          <p className="text-sm text-ink-soft mt-0.5">
            Issue new credentials and manage the institution's credential registry.
          </p>
        </div>
        <button
          onClick={() => setAdminAuthed(false)}
          className="text-sm text-ink-soft hover:text-ink border border-border rounded-md px-3 py-1.5 shrink-0"
        >
          Sign out
        </button>
      </div>

      <div className="flex gap-1 bg-white border border-border rounded-lg p-1 w-fit mb-6">
        <TabButton active={tab === 'issue'} onClick={() => setTab('issue')} icon={FileText}>
          Issue Credential
        </TabButton>
        <TabButton active={tab === 'manage'} onClick={() => setTab('manage')} icon={Table2}>
          Manage Credentials
        </TabButton>
      </div>

      {tab === 'issue' ? (
        <IssuePanel onIssued={refreshList} />
      ) : (
        <ManagePanel
          credentials={credentials}
          loading={loadingList}
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

const STEPS = [
  { key: 'pdf', label: 'Generating certificate PDF', icon: FileText },
  { key: 'hash', label: 'Computing SHA-256 document hash', icon: Hash },
  { key: 'tx', label: 'Submitting to smart contract', icon: Link2 },
  { key: 'confirm', label: 'Awaiting block confirmation', icon: CheckCircle2 },
];

function IssuePanel({ onIssued }) {
  const { notify } = useToast();
  const [form, setForm] = useState({
    studentName: '',
    studentId: '',
    credentialType: CREDENTIAL_TYPES[0],
    issueDate: new Date().toISOString().slice(0, 10),
  });
  const [stage, setStage] = useState('form'); // form | processing | success
  const [stepIndex, setStepIndex] = useState(-1);
  const [result, setResult] = useState(null);

  const update = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const canSubmit = form.studentName.trim() && form.studentId.trim() && form.credentialType;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    setStage('processing');
    setStepIndex(0);

    // Simulate the multi-step pipeline visually while the real (mock) API call runs.
    const stepTimer = setInterval(() => {
      setStepIndex((i) => (i < STEPS.length - 1 ? i + 1 : i));
    }, 550);

    try {
      const res = await issueCredential(form);
      clearInterval(stepTimer);
      setStepIndex(STEPS.length - 1);
      await new Promise((r) => setTimeout(r, 400));
      setResult(res);
      setStage('success');
      notify(`Credential ${res.credentialId} issued and recorded on-chain.`, 'success');
      onIssued();
    } catch {
      clearInterval(stepTimer);
      notify('Failed to issue credential. Please try again.', 'error');
      setStage('form');
    }
  };

  const handleReset = () => {
    setForm({
      studentName: '',
      studentId: '',
      credentialType: CREDENTIAL_TYPES[0],
      issueDate: new Date().toISOString().slice(0, 10),
    });
    setStage('form');
    setStepIndex(-1);
    setResult(null);
  };

  if (stage === 'success' && result) {
    return (
      <div className="bg-card border border-border rounded-lg card-shadow p-7 max-w-xl">
        <div className="w-11 h-11 rounded-lg bg-valid-soft flex items-center justify-center mb-4">
          <CheckCircle2 size={22} className="text-valid" />
        </div>
        <h2 className="text-lg font-semibold mb-1">Credential issued</h2>
        <p className="text-sm text-ink-soft mb-5">
          The credential has been recorded on-chain and is ready to share with the student.
        </p>

        <div className="flex gap-5 items-start mb-5">
          <div className="bg-white border border-border rounded-lg p-3 shrink-0">
            <QRCodeSVG value={result.qrPayload} size={112} fgColor="#1C2B2E" />
          </div>
          <div className="flex-1 space-y-2.5 min-w-0">
            <Field label="Credential ID" value={result.credentialId} mono />
            <Field label="Student" value={`${form.studentName} (${form.studentId})`} />
            <Field label="Credential type" value={form.credentialType} />
          </div>
        </div>

        <div className="space-y-2 mb-6">
          <HashChip label="Document hash" value={result.hash} />
          <HashChip label="Tx hash" value={result.txHash} />
        </div>

        <div className="flex gap-2">
          <button
            onClick={handleReset}
            className="flex items-center gap-1.5 text-sm font-medium bg-teal text-white rounded-md px-4 py-2 hover:bg-teal/90"
          >
            <RotateCcw size={14} />
            Issue another
          </button>
        </div>
      </div>
    );
  }

  if (stage === 'processing') {
    return (
      <div className="bg-card border border-border rounded-lg card-shadow p-7 max-w-xl">
        <h2 className="text-lg font-semibold mb-1">Issuing credential…</h2>
        <p className="text-sm text-ink-soft mb-6">
          Simulating certificate generation and the on-chain issuance transaction.
        </p>
        <div className="space-y-3">
          {STEPS.map((step, i) => {
            const Icon = step.icon;
            const done = i < stepIndex || (i === stepIndex && stepIndex === STEPS.length - 1 && result);
            const active = i === stepIndex && !done;
            const pending = i > stepIndex;
            return (
              <div
                key={step.key}
                className={`flex items-center gap-3 rounded-md px-3 py-2.5 border ${
                  active
                    ? 'border-teal bg-teal-soft'
                    : done
                    ? 'border-border bg-valid-soft/40'
                    : 'border-border bg-bg'
                }`}
              >
                <span
                  className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
                    done ? 'bg-valid text-white' : active ? 'bg-teal text-white' : 'bg-white text-ink-soft border border-border'
                  }`}
                >
                  {active ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : done ? (
                    <CheckCircle2 size={14} />
                  ) : (
                    <Icon size={13} />
                  )}
                </span>
                <span className={`text-sm ${pending ? 'text-ink-soft' : 'text-ink font-medium'}`}>
                  {step.label}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="bg-card border border-border rounded-lg card-shadow p-7 max-w-xl">
      <h2 className="text-lg font-semibold mb-1">Issue a new credential</h2>
      <p className="text-sm text-ink-soft mb-6">
        Fill in the student's details to generate and issue a verifiable credential.
      </p>

      <div className="space-y-4">
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

      <button
        type="submit"
        disabled={!canSubmit}
        className="mt-6 flex items-center gap-1.5 bg-teal text-white text-sm font-medium rounded-md px-4 py-2.5 hover:bg-teal/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <ShieldCheck size={15} />
        Issue credential on-chain
      </button>
    </form>
  );
}

function Field({ label, value, mono }) {
  return (
    <div>
      <p className="text-xs text-ink-soft">{label}</p>
      <p className={`text-sm text-ink ${mono ? 'font-mono' : 'font-medium'}`}>{value}</p>
    </div>
  );
}

function ManagePanel({ credentials, loading, onRevoked }) {
  const [revokeTarget, setRevokeTarget] = useState(null);

  return (
    <div className="bg-card border border-border rounded-lg card-shadow overflow-hidden">
      <div className="px-5 py-4 border-b border-border flex items-center justify-between">
        <h2 className="text-sm font-semibold">Issued credentials</h2>
        <span className="text-xs text-ink-soft">{credentials.length} records</span>
      </div>

      {loading ? (
        <div className="p-10 flex justify-center text-ink-soft">
          <Spinner size={20} />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-ink-soft border-b border-border">
                <th className="px-5 py-2.5 font-medium">Credential ID</th>
                <th className="px-5 py-2.5 font-medium">Student</th>
                <th className="px-5 py-2.5 font-medium">Type</th>
                <th className="px-5 py-2.5 font-medium">Issue date</th>
                <th className="px-5 py-2.5 font-medium">Status</th>
                <th className="px-5 py-2.5 font-medium text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {credentials.map((c) => (
                <tr key={c.credentialId} className="border-b border-border last:border-0 hover:bg-bg/60">
                  <td className="px-5 py-3 font-mono text-xs text-ink-soft">{c.credentialId}</td>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-1.5">
                      <User size={13} className="text-ink-soft" />
                      <div>
                        <p className="font-medium leading-tight">{c.studentName}</p>
                        <p className="text-xs text-ink-soft leading-tight">{c.studentId}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-3 text-ink-soft">{c.credentialType}</td>
                  <td className="px-5 py-3 text-ink-soft">{c.issueDate}</td>
                  <td className="px-5 py-3">
                    <StatusBadge status={c.status} size="sm" />
                  </td>
                  <td className="px-5 py-3 text-right">
                    {c.status === 'valid' ? (
                      <button
                        onClick={() => setRevokeTarget(c)}
                        className="inline-flex items-center gap-1 text-xs font-medium text-invalid border border-invalid/30 rounded-md px-2.5 py-1.5 hover:bg-invalid-soft"
                      >
                        <Ban size={12} />
                        Revoke
                      </button>
                    ) : (
                      <span className="text-xs text-ink-soft">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {revokeTarget && (
        <RevokeModal
          credential={revokeTarget}
          onClose={() => setRevokeTarget(null)}
          onRevoked={() => {
            setRevokeTarget(null);
            onRevoked();
          }}
        />
      )}
    </div>
  );
}

function RevokeModal({ credential, onClose, onRevoked }) {
  const { notify } = useToast();
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);

  const handleConfirm = async () => {
    setLoading(true);
    try {
      await revokeCredential(credential.credentialId, reason);
      notify(`Credential ${credential.credentialId} has been revoked.`, 'warning');
      onRevoked();
    } catch {
      notify('Failed to revoke credential.', 'error');
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 px-4">
      <div className="bg-card border border-border rounded-lg card-shadow w-full max-w-md p-6">
        <div className="w-10 h-10 rounded-lg bg-revoked-soft flex items-center justify-center mb-3">
          <Ban size={18} className="text-revoked" />
        </div>
        <h3 className="text-base font-semibold mb-1">Revoke credential</h3>
        <p className="text-sm text-ink-soft mb-4">
          You're about to revoke <span className="font-medium text-ink">{credential.credentialId}</span>{' '}
          issued to <span className="font-medium text-ink">{credential.studentName}</span>. This
          action will mark the on-chain record as revoked and cannot be undone in this prototype.
        </p>
        <label className="block text-xs font-medium text-ink-soft mb-1.5">
          Revocation reason
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
            onClick={onClose}
            disabled={loading}
            className="text-sm font-medium text-ink-soft border border-border rounded-md px-4 py-2 hover:bg-bg"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={loading}
            className="flex items-center gap-1.5 text-sm font-medium bg-revoked text-white rounded-md px-4 py-2 hover:bg-revoked/90 disabled:opacity-60"
          >
            {loading && <Spinner size={13} />}
            {loading ? 'Revoking…' : 'Confirm revocation'}
          </button>
        </div>
      </div>
    </div>
  );
}
