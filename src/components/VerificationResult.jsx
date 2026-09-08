import { useState } from 'react';
import { BadgeCheck, Building2, CalendarDays, Ban, Clock, Eye, Hash } from 'lucide-react';
import VerificationStateBanner from './VerificationStateBanner';
import VerificationChecks from './VerificationChecks';
import CredentialDNA from './CredentialDNA';
import HashChip from './HashChip';
import VerificationProofModal from './VerificationProofModal';
import { resolveVerificationState, getVerificationChecks } from '../lib/verification';

const CARD_TONE = {
  verified: 'bg-valid-soft/40 border-valid/25',
  revoked: 'bg-revoked-soft/50 border-revoked/25',
  mismatch: 'bg-invalid-soft/50 border-invalid/25',
  not_found: 'bg-invalid-soft/40 border-invalid/20',
};

/**
 * The primary verification result — one of four distinct states (verified,
 * revoked, document altered, not found), each with its own checklist and
 * evidence. `queryType` ('id' | 'hash') disambiguates "not found" from
 * "document altered" for an 'invalid' result — see lib/verification.js.
 *
 * `referenceCredential` (optional): the last credential this browser
 * session actually verified. When a subsequent upload comes back as a
 * mismatch, this lets the result honestly show what it's being compared
 * against — e.g. "verify the original, then verify a tampered copy" — the
 * intended tamper-detection demo — without ever pretending the system
 * auto-identified which record a random unmatched file "belongs to".
 */
export default function VerificationResult({ result, queryType, verifiedAt, referenceCredential }) {
  const state = resolveVerificationState(result.status, queryType);
  const hasReference = state === 'mismatch' && Boolean(referenceCredential);
  const { checks, passed, total } = getVerificationChecks(state, queryType, { hasReference });
  const d = result.details;
  const showRecord = state === 'verified' || state === 'revoked';
  const [proofOpen, setProofOpen] = useState(false);

  return (
    <div className={`rounded-lg border card-shadow p-6 sm:p-7 ${CARD_TONE[state]}`}>
      <div className="mb-5">
        <VerificationStateBanner state={state} align="center" size="lg" />
      </div>

      <div className="bg-white rounded-md border border-border p-4 sm:p-5 space-y-4">
        <VerificationChecks checks={checks} passed={passed} total={total} />

        {showRecord && (
          <div className="border-t border-border pt-4 space-y-3">
            <p className="text-xs text-ink-soft">
              This credential matches the record registered by{' '}
              <span className="font-medium text-ink">{d.issuer}</span>.
            </p>
            <div>
              <p className="text-sm font-medium leading-snug flex items-center gap-1.5">
                <BadgeCheck size={14} className="text-ink-soft shrink-0" />
                {d.credentialType}
              </p>
              <p className="text-xs text-ink-soft flex items-center gap-1 mt-1">
                <Building2 size={12} />
                {d.issuer}
              </p>
              <p className="text-xs text-ink-soft flex items-center gap-1 mt-0.5">
                <CalendarDays size={12} />
                Issued {d.issueDate}
              </p>
              <p className="text-xs text-ink-soft mt-0.5">
                {d.studentName} · <span className="font-mono">{d.studentId}</span>
              </p>
              <p className="text-xs font-mono text-ink-soft mt-1">{d.credentialId}</p>
            </div>

            <CredentialDNA hash={d.hash} expandable />

            {state === 'revoked' && (
              <div className="bg-revoked-soft text-revoked text-xs rounded-md px-3 py-2 flex items-start gap-1.5">
                <Ban size={13} className="shrink-0 mt-0.5" />
                <span>
                  Revoked on {d.revocation?.date} — {d.revocation?.reason}
                </span>
              </div>
            )}

            <div className="flex items-center justify-between gap-3 pt-1">
              {verifiedAt && (
                <p className="text-[11px] text-ink-soft flex items-center gap-1">
                  <Clock size={11} aria-hidden="true" />
                  Verification complete · {verifiedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </p>
              )}
              <button
                onClick={() => setProofOpen(true)}
                className="flex items-center gap-1.5 text-xs font-medium text-teal border border-teal/30 rounded-md px-3 py-1.5 hover:bg-teal-soft/60 ml-auto"
              >
                <Eye size={12} aria-hidden="true" />
                View Verification Proof
              </button>
            </div>
          </div>
        )}

        {state === 'mismatch' && (
          <div className="border-t border-border pt-4 space-y-3">
            <div>
              <p className="text-[11px] text-ink-soft mb-1 flex items-center gap-1">
                <Hash size={11} aria-hidden="true" />
                Uploaded document fingerprint
              </p>
              <HashChip value={d.submittedHash} />
            </div>

            {hasReference && (
              <div>
                <p className="text-[11px] text-ink-soft mb-1 flex items-center gap-1">
                  <Hash size={11} aria-hidden="true" />
                  Registered Credential DNA (last verified in this session:{' '}
                  {referenceCredential.credentialId})
                </p>
                <HashChip value={referenceCredential.hash} />
              </div>
            )}

            <p className="text-xs text-ink-soft">
              This fingerprint doesn't match a registered credential. That proves the submitted
              file's bytes differ from what was originally issued — it does not, by itself,
              identify who or what changed them. The document may have been modified after
              issuance.
            </p>
          </div>
        )}

        {state === 'not_found' && (
          <div className="border-t border-border pt-4 space-y-1.5">
            <p className="text-xs text-ink-soft">
              No credential record matches ID{' '}
              <span className="font-mono text-ink">{d.submittedId}</span>.
            </p>
            <p className="text-xs text-ink-soft">
              This system cannot establish authenticity for unrecorded information. Verification
              could not be completed.
            </p>
          </div>
        )}
      </div>

      {proofOpen && showRecord && (
        <VerificationProofModal credential={d} onClose={() => setProofOpen(false)} />
      )}
    </div>
  );
}
