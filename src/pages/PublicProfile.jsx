import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  Link2,
  ShieldCheck,
  ShieldAlert,
  Building2,
  CalendarDays,
  BadgeCheck,
  Ban,
  Search,
  GraduationCap,
  Share2,
  Download,
  FileText,
  Fingerprint,
  Database,
  ScanEye,
} from 'lucide-react';
import Spinner from '../components/Spinner';
import StatusBadge from '../components/StatusBadge';
import CredentialDNA from '../components/CredentialDNA';
import AcademicJourney from '../components/AcademicJourney';
import ShareProfileModal from '../components/ShareProfileModal';
import { useToast } from '../context/ToastContext';
import { getCredentialsForStudent } from '../lib/mockApi';
import { downloadVerifiedResumePdf } from '../lib/generateCertificatePdf';
import {
  buildStudentProfile,
  groupCredentialsByYear,
  buildProfileUrl,
  getInitials,
  getProfileVerificationState,
} from '../lib/studentProfile';

const STATE_META = {
  verified: {
    Icon: ShieldCheck,
    text: 'text-valid',
    bg: 'bg-valid-soft',
    label: 'Verified Academic Profile',
    body: 'All credentials currently appear valid and unrevoked.',
  },
  attention: {
    Icon: ShieldAlert,
    text: 'text-revoked',
    bg: 'bg-revoked-soft',
    label: 'Attention Required',
    body: 'Some credentials in this profile have been revoked.',
  },
  none: {
    Icon: ShieldAlert,
    text: 'text-invalid',
    bg: 'bg-invalid-soft',
    label: 'No Active Credentials',
    body: 'No credentials in this profile are currently active.',
  },
  empty: {
    Icon: ShieldAlert,
    text: 'text-ink-soft',
    bg: 'bg-bg',
    label: 'No Credentials',
    body: 'No verified credentials available.',
  },
};

const TRUST_STEPS = [
  { n: '01', title: 'Issued', icon: FileText, body: 'Credential issued by the institution.' },
  { n: '02', title: 'Fingerprinted', icon: Fingerprint, body: 'The certificate receives a unique cryptographic fingerprint.' },
  { n: '03', title: 'Recorded', icon: Database, body: 'The credential record preserves the verification reference.' },
  { n: '04', title: 'Verified', icon: ScanEye, body: 'A verifier can independently check the credential.' },
];

/**
 * The public-facing "Verified Professional Passport" — what a shared
 * profile link or QR code resolves to. A deliberately distinct, recruiter-
 * facing presentation of the same underlying data as the private Student
 * Portal, not a re-export of it: no full hashes, no revocation reasons, no
 * ledger/tx references, no dashboard-style editing affordances.
 */
export default function PublicProfile() {
  const { studentId } = useParams();
  const { notify } = useToast();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setNotFound(false);
    getCredentialsForStudent(studentId).then((data) => {
      if (cancelled) return;
      if (data.length === 0) {
        setNotFound(true);
      } else {
        setProfile(buildStudentProfile(studentId, data));
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [studentId]);

  if (loading) {
    return (
      <div className="min-h-[calc(100vh-8rem)] flex justify-center items-center text-ink-soft">
        <Spinner size={22} />
      </div>
    );
  }

  if (notFound || !profile) {
    return (
      <div className="max-w-lg mx-auto px-4 py-16 text-center">
        <div className="w-12 h-12 rounded-full bg-invalid-soft flex items-center justify-center mx-auto mb-4">
          <ShieldAlert size={22} className="text-invalid" />
        </div>
        <h1 className="text-lg font-semibold mb-1">Profile not found</h1>
        <p className="text-sm text-ink-soft">
          No academic passport exists for student ID{' '}
          <span className="font-mono">{studentId}</span>.
        </p>
      </div>
    );
  }

  const profileUrl = buildProfileUrl(studentId);
  const state = getProfileVerificationState(profile.stats);
  const meta = STATE_META[state];
  const StateIcon = meta.Icon;
  const initials = getInitials(profile.studentName);
  const yearGroups = groupCredentialsByYear(profile.credentialsDesc);

  const handleVerifyCredentials = () => {
    document.getElementById('public-credentials')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const handleDownloadResume = () => {
    downloadVerifiedResumePdf(profile, profile.credentialsDesc, profileUrl);
    notify('Verified resume PDF downloaded.', 'info');
  };

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-5 py-10">
      <div className="flex items-center justify-center gap-2 mb-6">
        <span className="w-7 h-7 rounded-lg bg-teal flex items-center justify-center">
          <Link2 size={14} className="text-white" strokeWidth={2.5} />
        </span>
        <span className="text-xs font-semibold tracking-[0.14em] text-ink-soft uppercase">
          Chain of Record
        </span>
      </div>

      {/* Action bar */}
      <div className="flex flex-wrap gap-2 mb-6">
        <button
          onClick={handleVerifyCredentials}
          className="flex-1 min-w-[130px] flex items-center justify-center gap-1.5 text-sm font-medium bg-teal text-white rounded-md px-3 py-2.5 hover:bg-teal/90"
        >
          <Search size={14} aria-hidden="true" />
          Verify credentials
        </button>
        <button
          onClick={() => setShareOpen(true)}
          className="flex-1 min-w-[110px] flex items-center justify-center gap-1.5 text-sm font-medium border border-border rounded-md px-3 py-2.5 hover:bg-bg bg-white"
        >
          <Share2 size={14} aria-hidden="true" />
          Share
        </button>
        <button
          onClick={handleDownloadResume}
          className="flex-1 min-w-[130px] flex items-center justify-center gap-1.5 text-sm font-medium border border-border rounded-md px-3 py-2.5 hover:bg-bg bg-white"
        >
          <Download size={14} aria-hidden="true" />
          Verified resume
        </button>
      </div>

      {/* Header */}
      <div className="bg-card border border-border rounded-lg card-shadow p-7 sm:p-9 text-center mb-6">
        <p className="text-[11px] font-semibold tracking-[0.14em] text-teal uppercase mb-4">
          Verified Professional Passport
        </p>

        <span className="w-16 h-16 rounded-full bg-teal-soft flex items-center justify-center mx-auto mb-4 text-teal text-lg font-semibold">
          {initials || <GraduationCap size={26} />}
        </span>

        <h1 className="text-2xl font-semibold leading-tight">{profile.studentName}</h1>
        {profile.primaryProgram && (
          <p className="text-sm text-ink-soft mt-1">{profile.primaryProgram}</p>
        )}
        {profile.primaryInstitution && (
          <p className="text-xs text-ink-soft flex items-center justify-center gap-1 mt-1.5">
            <Building2 size={12} />
            {profile.primaryInstitution}
          </p>
        )}

        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 mt-2.5 text-xs text-ink-soft">
          <span className="font-mono">Student ID: {profile.studentId}</span>
          {profile.latestIssueYear && <span>Class of {profile.latestIssueYear}</span>}
        </div>

        <div className="mt-5 flex justify-center">
          <span
            className={`inline-flex items-center gap-1.5 ${meta.bg} ${meta.text} text-sm font-medium rounded-full px-3.5 py-1.5`}
          >
            <StateIcon size={15} aria-hidden="true" />
            {meta.label}
          </span>
        </div>

        <p className="text-xs text-ink-soft italic mt-4">"Credentials can be independently verified."</p>
      </div>

      {/* Verification summary */}
      <div className="mb-6">
        <h2 className="text-xs font-semibold tracking-wide text-ink-soft uppercase mb-2.5">
          Verification summary
        </h2>
        <div className="grid grid-cols-3 gap-3">
          <SummaryTile value={profile.stats.total} label={profile.stats.total === 1 ? 'Credential' : 'Credentials'} />
          <SummaryTile value={profile.stats.active} label="Active" />
          <SummaryTile
            value={profile.stats.institutions}
            label={profile.stats.institutions === 1 ? 'Institution' : 'Institutions'}
          />
        </div>
        <p className="text-xs text-ink-soft mt-2.5">{meta.body}</p>
      </div>

      <div className="mb-6">
        <AcademicJourney yearGroups={yearGroups} title="Academic journey" />
      </div>

      {/* Verified credentials */}
      <div id="public-credentials" className="mb-6 scroll-mt-6">
        <h2 className="text-base font-semibold mb-3.5">Verified credentials</h2>
        {profile.credentialsDesc.length === 0 ? (
          <div className="bg-card border border-border rounded-lg p-6 text-center text-sm text-ink-soft">
            No verified credentials available.
          </div>
        ) : (
          <div className="space-y-4">
            {profile.credentialsDesc.map((c) => (
              <PublicCredentialCard key={c.credentialId} credential={c} />
            ))}
          </div>
        )}
      </div>

      {/* Why this profile is verifiable */}
      <div className="bg-card border border-border rounded-lg card-shadow p-5 sm:p-6 mb-6">
        <h2 className="text-sm font-semibold mb-4">Why this profile is verifiable</h2>
        <div className="grid sm:grid-cols-4 gap-4 mb-5">
          {TRUST_STEPS.map(({ n, title, icon: Icon, body }) => (
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
          Current prototype: blockchain anchoring is simulated. Document integrity uses SHA-256
          fingerprint verification.
        </p>
      </div>

      <p className="text-center text-xs text-ink-soft">
        Powered by <span className="font-medium text-ink">Chain of Record</span> — don't just show
        your certificates, prove them.
      </p>

      {shareOpen && (
        <ShareProfileModal profile={profile} profileUrl={profileUrl} onClose={() => setShareOpen(false)} />
      )}
    </div>
  );
}

function SummaryTile({ value, label }) {
  return (
    <div className="bg-card border border-border rounded-lg card-shadow py-3.5 text-center">
      <p className="text-lg font-semibold leading-tight">{value}</p>
      <p className="text-[11px] text-ink-soft leading-tight truncate">{label}</p>
    </div>
  );
}

function PublicCredentialCard({ credential }) {
  const revoked = credential.status === 'revoked';
  return (
    <div
      className={`bg-card border rounded-lg card-shadow p-5 ${revoked ? 'border-revoked/25' : 'border-border'}`}
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-center gap-1.5 min-w-0">
          {revoked ? (
            <Ban size={15} className="text-revoked shrink-0" aria-hidden="true" />
          ) : (
            <BadgeCheck size={15} className="text-valid shrink-0" aria-hidden="true" />
          )}
          <h3 className="text-sm font-semibold truncate">{credential.credentialType}</h3>
        </div>
        <StatusBadge status={credential.status} size="sm" />
      </div>

      <p className="text-xs text-ink-soft flex items-center gap-1 mb-0.5">
        <Building2 size={11} aria-hidden="true" />
        {credential.issuer}
      </p>
      <p className="text-xs text-ink-soft flex items-center gap-1 mb-3">
        <CalendarDays size={11} aria-hidden="true" />
        Issued {credential.issueDate}
      </p>

      {revoked && (
        <p className="bg-revoked-soft text-revoked text-xs rounded-md px-3 py-2 mb-3">
          This credential exists in the record but is no longer active.
          {credential.revocation?.date && ` Revoked ${credential.revocation.date}.`}
        </p>
      )}

      <div className="border border-border rounded-md p-3 mb-3 bg-bg/50">
        <CredentialDNA hash={credential.hash} compact shorten />
      </div>

      <div className="flex items-center justify-between gap-3">
        <span className="text-[11px] font-mono text-ink-soft truncate">{credential.credentialId}</span>
        <Link
          to={`/verify?credentialId=${encodeURIComponent(credential.credentialId)}`}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-teal border border-teal/30 rounded-md px-3 py-1.5 hover:bg-teal-soft/60 shrink-0"
        >
          <Search size={12} aria-hidden="true" />
          Verify credential
        </Link>
      </div>
    </div>
  );
}
