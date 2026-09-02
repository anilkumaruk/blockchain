import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import {
  GraduationCap,
  Download,
  Link as LinkIcon,
  Check,
  Building2,
  CalendarDays,
} from 'lucide-react';
import { useToast } from '../context/ToastContext';
import StatusBadge from '../components/StatusBadge';
import Spinner from '../components/Spinner';
import { getCredentialsForStudent, DEMO_STUDENT_ID } from '../lib/mockApi';
import { downloadCertificatePdf } from '../lib/generateCertificatePdf';

export default function StudentPortal() {
  const { notify } = useToast();
  const [credentials, setCredentials] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getCredentialsForStudent(DEMO_STUDENT_ID).then((data) => {
      setCredentials(data);
      setLoading(false);
    });
  }, []);

  const studentName = credentials[0]?.studentName || 'Ananya Sharma';

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-5 py-8">
      <div className="flex items-center gap-3 mb-1">
        <span className="w-11 h-11 rounded-full bg-teal-soft flex items-center justify-center shrink-0">
          <GraduationCap size={20} className="text-teal" />
        </span>
        <div>
          <h1 className="text-xl font-semibold leading-tight">{studentName}</h1>
          <p className="text-sm text-ink-soft leading-tight">{DEMO_STUDENT_ID}</p>
        </div>
      </div>
      <p className="text-sm text-ink-soft mt-4 mb-6">
        Your verifiable academic credentials, issued and anchored on-chain by your institution.
      </p>

      {loading ? (
        <div className="p-16 flex justify-center text-ink-soft">
          <Spinner size={22} />
        </div>
      ) : credentials.length === 0 ? (
        <div className="bg-card border border-border rounded-lg p-8 text-center text-sm text-ink-soft">
          No credentials issued yet.
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 gap-5">
          {credentials.map((c) => (
            <CredentialCard key={c.credentialId} credential={c} notify={notify} />
          ))}
        </div>
      )}
    </div>
  );
}

function CredentialCard({ credential, notify }) {
  const [copied, setCopied] = useState(false);

  const handleShare = async () => {
    const url = `${window.location.origin}/verify?credentialId=${credential.credentialId}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      notify('Verification link copied to clipboard.', 'success');
      setTimeout(() => setCopied(false), 1800);
    } catch {
      notify('Could not copy link — clipboard unavailable.', 'error');
    }
  };

  const handleDownload = () => {
    downloadCertificatePdf(credential);
    notify('Certificate PDF downloaded.', 'info');
  };

  return (
    <div className="bg-card border border-border rounded-lg card-shadow p-5 flex flex-col">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <h3 className="font-semibold leading-snug">{credential.credentialType}</h3>
          <p className="text-xs text-ink-soft mt-0.5 flex items-center gap-1">
            <Building2 size={12} />
            {credential.issuer}
          </p>
        </div>
        <StatusBadge status={credential.status} size="sm" />
      </div>

      <p className="text-xs text-ink-soft flex items-center gap-1 mb-4">
        <CalendarDays size={12} />
        Issued {credential.issueDate}
      </p>

      <div className="flex items-center gap-4 mb-4">
        <div className="bg-white border border-border rounded-lg p-2 shrink-0">
          <QRCodeSVG value={credential.credentialId} size={76} fgColor="#1C2B2E" />
        </div>
        <div className="min-w-0">
          <p className="text-xs text-ink-soft">Credential ID</p>
          <p className="text-sm font-mono truncate">{credential.credentialId}</p>
        </div>
      </div>

      {credential.status === 'revoked' && credential.revocation && (
        <div className="bg-revoked-soft text-revoked text-xs rounded-md px-3 py-2 mb-4">
          Revoked on {credential.revocation.date} — {credential.revocation.reason}
        </div>
      )}

      <div className="mt-auto flex gap-2 pt-1">
        <button
          onClick={handleDownload}
          className="flex-1 flex items-center justify-center gap-1.5 text-sm font-medium bg-teal text-white rounded-md px-3 py-2 hover:bg-teal/90"
        >
          <Download size={14} />
          Download
        </button>
        <button
          onClick={handleShare}
          className="flex-1 flex items-center justify-center gap-1.5 text-sm font-medium border border-border rounded-md px-3 py-2 hover:bg-bg"
        >
          {copied ? <Check size={14} className="text-valid" /> : <LinkIcon size={14} />}
          {copied ? 'Copied' : 'Share link'}
        </button>
      </div>
    </div>
  );
}
