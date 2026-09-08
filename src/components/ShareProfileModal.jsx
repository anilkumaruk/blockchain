import { useEffect, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import {
  X,
  Copy,
  Check,
  ExternalLink,
  ShieldCheck,
  ShieldAlert,
  MessageSquareText,
  QrCode,
  Landmark,
} from 'lucide-react';
import { useToast } from '../context/ToastContext';
import { getInitials, getProfileVerificationState } from '../lib/studentProfile';

const STATE_META = {
  verified: { Icon: ShieldCheck, text: 'text-valid', bg: 'bg-valid-soft', label: 'Verified Academic Identity' },
  attention: { Icon: ShieldAlert, text: 'text-revoked', bg: 'bg-revoked-soft', label: 'Attention required' },
  none: { Icon: ShieldAlert, text: 'text-invalid', bg: 'bg-invalid-soft', label: 'No active credentials' },
  empty: { Icon: ShieldAlert, text: 'text-ink-soft', bg: 'bg-bg', label: 'No credentials yet' },
};

/**
 * "Share your Verified Professional Passport" — the one dialog students use
 * to hand a single link to an employer, recruiter, or verifier. Everything
 * shown (name, program, institution, stats, state) is derived from the same
 * profile object the Student Portal and Public Profile already build from
 * studentProfile.js — nothing here is a second source of truth.
 */
export default function ShareProfileModal({ profile, profileUrl, onClose }) {
  const { notify } = useToast();
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedMessage, setCopiedMessage] = useState(false);
  const closeButtonRef = useRef(null);

  useEffect(() => {
    closeButtonRef.current?.focus();
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const state = getProfileVerificationState(profile.stats);
  const meta = STATE_META[state];
  const StateIcon = meta.Icon;
  const initials = getInitials(profile.studentName);

  const verificationMessage = `Here is my verified academic profile. You can independently verify my credentials through Chain of Record.\n\n${profileUrl}`;

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(profileUrl);
      setCopiedLink(true);
      notify('Profile link copied', 'success');
      setTimeout(() => setCopiedLink(false), 1800);
    } catch {
      notify('Could not copy link — clipboard unavailable.', 'error');
    }
  };

  const handleCopyMessage = async () => {
    try {
      await navigator.clipboard.writeText(verificationMessage);
      setCopiedMessage(true);
      notify('Verification message copied', 'success');
      setTimeout(() => setCopiedMessage(false), 1800);
    } catch {
      notify('Could not copy message — clipboard unavailable.', 'error');
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 px-4 py-8 overflow-y-auto"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Share your Verified Professional Passport"
    >
      <div
        className="bg-card border border-border rounded-lg card-shadow w-full max-w-md p-6 animate-modal-in my-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-base font-semibold">Your Verified Professional Passport</h3>
            <p className="text-sm text-ink-soft mt-0.5">
              Share one link that lets others independently verify your academic credentials.
            </p>
          </div>
          <button
            ref={closeButtonRef}
            onClick={onClose}
            className="text-ink-soft hover:text-ink shrink-0"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Passport preview card */}
        <div className="border border-border rounded-lg p-4 bg-bg/60 mb-5">
          <p className="text-[10px] font-semibold tracking-[0.12em] text-ink-soft uppercase mb-3">
            Verified Professional Passport
          </p>
          <div className="flex items-center gap-3 mb-3">
            <span className="w-10 h-10 rounded-full bg-teal-soft flex items-center justify-center text-teal text-sm font-semibold shrink-0">
              {initials}
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold truncate">{profile.studentName}</p>
              {profile.primaryProgram && (
                <p className="text-xs text-ink-soft truncate">{profile.primaryProgram}</p>
              )}
            </div>
          </div>
          {profile.primaryInstitution && (
            <p className="text-xs text-ink-soft flex items-center gap-1 mb-3">
              <Landmark size={12} aria-hidden="true" />
              {profile.primaryInstitution}
            </p>
          )}
          <span
            className={`inline-flex items-center gap-1.5 ${meta.bg} ${meta.text} text-xs font-medium rounded-full px-2.5 py-1 mb-3`}
          >
            <StateIcon size={12} aria-hidden="true" />
            {meta.label}
          </span>

          <div className="grid grid-cols-3 gap-2 mb-3">
            <MiniStat value={profile.stats.total} label={profile.stats.total === 1 ? 'Credential' : 'Credentials'} />
            <MiniStat value={profile.stats.active} label="Active" />
            <MiniStat
              value={profile.stats.institutions}
              label={profile.stats.institutions === 1 ? 'Institution' : 'Institutions'}
            />
          </div>

          <a
            href={profileUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-center gap-1.5 text-xs font-medium border border-border rounded-md px-3 py-2 hover:bg-bg bg-white"
          >
            <ExternalLink size={13} aria-hidden="true" />
            Open profile
          </a>
        </div>

        {/* Share actions */}
        <p className="text-xs font-semibold text-ink-soft mb-2">Share your profile</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-5">
          <button
            onClick={handleCopyLink}
            className="flex items-center justify-center gap-1.5 text-xs font-medium bg-teal text-white rounded-md px-3 py-2.5 hover:bg-teal/90"
          >
            {copiedLink ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
            {copiedLink ? 'Profile link copied' : 'Copy profile link'}
          </button>
          <button
            onClick={handleCopyMessage}
            className="flex items-center justify-center gap-1.5 text-xs font-medium border border-border rounded-md px-3 py-2.5 hover:bg-bg"
          >
            {copiedMessage ? (
              <Check size={13} aria-hidden="true" />
            ) : (
              <MessageSquareText size={13} aria-hidden="true" />
            )}
            {copiedMessage ? 'Message copied' : 'Copy verification message'}
          </button>
        </div>

        {/* QR */}
        <div className="flex flex-col items-center border-t border-border pt-5">
          <div className="bg-white border border-border rounded-lg p-3 mb-2">
            <QRCodeSVG value={profileUrl} size={168} fgColor="#1C2B2E" />
          </div>
          <p className="text-xs text-ink-soft flex items-center gap-1">
            <QrCode size={12} aria-hidden="true" />
            Scan to verify academic credentials
          </p>
        </div>
      </div>
    </div>
  );
}

function MiniStat({ value, label }) {
  return (
    <div className="bg-white border border-border rounded-md py-1.5 text-center">
      <p className="text-sm font-semibold leading-tight">{value}</p>
      <p className="text-[10px] text-ink-soft leading-tight truncate">{label}</p>
    </div>
  );
}
