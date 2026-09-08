import { useState } from 'react';
import { Fingerprint, Copy, Check, ShieldCheck, ChevronDown } from 'lucide-react';
import { useToast } from '../context/ToastContext';
import HashChip from './HashChip';
import { hashToFingerprintCells } from '../lib/verification';

/** First 10 + last 4 hex characters — a short, non-actionable preview of a hash. */
export function shortenHash(hash) {
  const str = String(hash);
  if (str.length <= 18) return str;
  return `${str.slice(0, 10)}…${str.slice(-4)}`;
}

/**
 * "Credential DNA" — the real SHA-256 fingerprint of a credential, shown
 * with a small deterministic visual pattern derived from the same hash.
 * The pattern is decorative only; the hash itself is always the source of
 * truth and is never replaced or approximated by it.
 *
 * Pass `shorten` for public-facing, read-only contexts (e.g. the Verified
 * Professional Passport) where a visitor shouldn't need — or be invited to
 * casually copy — the complete hash; there's no way to expand it there.
 *
 * Pass `expandable` for contexts that want the shortened view by default
 * but let the user reveal (and copy) the full hash on demand — e.g. the
 * Employer/Verifier result, where the plain-language layer stays clean but
 * the real value is one click away, not hidden behind a separate flow.
 */
export default function CredentialDNA({
  hash,
  label = 'Credential DNA',
  gridSize = 6,
  compact = false,
  shorten = false,
  expandable = false,
}) {
  const { notify } = useToast();
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const cells = hashToFingerprintCells(hash, gridSize);
  const cell = compact ? 7 : 9;
  const showFull = !shorten && (expanded || !expandable);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(hash);
      setCopied(true);
      notify('Credential DNA copied to clipboard.', 'success');
      setTimeout(() => setCopied(false), 1800);
    } catch {
      notify('Could not copy — clipboard unavailable.', 'error');
    }
  };

  return (
    <div>
      <p className="text-[11px] font-medium text-ink-soft mb-1.5 flex items-center gap-1.5">
        <Fingerprint size={12} aria-hidden="true" />
        {label}
      </p>
      <div className="flex items-center gap-3 mb-2">
        <div
          className="grid gap-[3px] shrink-0"
          style={{ gridTemplateColumns: `repeat(${gridSize}, minmax(0, 1fr))` }}
          role="img"
          aria-label={`Visual fingerprint pattern derived from credential DNA ${hash}`}
        >
          {cells.map((v, i) => (
            <span
              key={i}
              aria-hidden="true"
              className="block rounded-[2px]"
              style={{
                width: cell,
                height: cell,
                backgroundColor: `rgba(46, 85, 104, ${0.12 + v * 0.75})`,
              }}
            />
          ))}
        </div>
        <div className="flex-1 min-w-0">
          {showFull ? (
            <HashChip value={hash} />
          ) : (
            <code className="text-xs font-mono text-ink-soft" title="Full fingerprint available on request">
              {shortenHash(hash)}
            </code>
          )}
        </div>
      </div>

      {shorten ? (
        <p className="flex items-center gap-1.5 text-xs text-valid font-medium">
          <ShieldCheck size={12} aria-hidden="true" />
          Fingerprint registered
        </p>
      ) : (
        <div className="flex items-center gap-3 flex-wrap">
          <button
            type="button"
            onClick={handleCopy}
            className="flex items-center gap-1.5 text-xs font-medium text-teal hover:underline"
          >
            {copied ? <Check size={12} aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}
            {copied ? 'Copied' : 'Copy Credential DNA'}
          </button>
          {expandable && (
            <button
              type="button"
              onClick={() => setExpanded((e) => !e)}
              className="flex items-center gap-1 text-xs font-medium text-ink-soft hover:text-ink"
              aria-expanded={expanded}
            >
              {expanded ? 'Hide full fingerprint' : 'View full fingerprint'}
              <ChevronDown
                size={12}
                className={`transition-transform ${expanded ? 'rotate-180' : ''}`}
                aria-hidden="true"
              />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
