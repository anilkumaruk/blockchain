import { CheckCircle2, ShieldAlert, OctagonAlert, SearchX, History, Trash2 } from 'lucide-react';

const STORAGE_KEY = 'cor-verifier-history-v1';
const MAX_ENTRIES = 10;

const ICONS = {
  verified: { Icon: CheckCircle2, className: 'text-valid bg-valid-soft' },
  revoked: { Icon: ShieldAlert, className: 'text-revoked bg-revoked-soft' },
  mismatch: { Icon: OctagonAlert, className: 'text-invalid bg-invalid-soft' },
  not_found: { Icon: SearchX, className: 'text-invalid bg-invalid-soft' },
};

const RESULT_LABEL = {
  verified: 'Verified',
  revoked: 'Revoked',
  mismatch: 'Document altered',
  not_found: 'Not found',
};

/**
 * A lightweight, purely local record of verification checks run in THIS
 * browser — explicitly not an institutional audit log (the mock API has no
 * server, so there is nothing else it honestly could be). Read/write
 * helpers live here so VerificationUI.jsx doesn't need to know the storage
 * format.
 */
export function loadVerificationHistory() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function pushVerificationHistory(entry) {
  try {
    const current = loadVerificationHistory();
    const next = [{ ...entry, checkedAt: new Date().toISOString() }, ...current].slice(0, MAX_ENTRIES);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    return next;
  } catch {
    return loadVerificationHistory();
  }
}

export function clearVerificationHistory() {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
  return [];
}

function timeAgo(iso) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function VerificationHistory({ entries, onSelect, onClear }) {
  if (entries.length === 0) return null;

  return (
    <div className="mt-6">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-semibold flex items-center gap-1.5">
          <History size={14} aria-hidden="true" />
          Recent checks on this device
        </h2>
        <button
          onClick={onClear}
          className="flex items-center gap-1 text-xs text-ink-soft hover:text-invalid"
        >
          <Trash2 size={11} aria-hidden="true" />
          Clear
        </button>
      </div>
      <p className="text-xs text-ink-soft mb-3">
        Stored locally in this browser only — not a server-side or institutional record.
      </p>
      <div className="bg-card border border-border rounded-lg card-shadow divide-y divide-border">
        {entries.map((e, i) => {
          const cfg = ICONS[e.result] || ICONS.not_found;
          const Icon = cfg.Icon;
          const clickable = Boolean(e.credentialId) && onSelect;
          const Row = clickable ? 'button' : 'div';
          return (
            <Row
              key={`${e.checkedAt}-${i}`}
              onClick={clickable ? () => onSelect(e.credentialId) : undefined}
              className={`w-full flex items-center gap-3 px-4 py-2.5 text-left ${
                clickable ? 'hover:bg-bg/60 cursor-pointer' : ''
              }`}
            >
              <span className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${cfg.className}`}>
                <Icon size={13} aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm truncate">{e.label}</p>
                <p className="text-xs text-ink-soft">{RESULT_LABEL[e.result] || e.result}</p>
              </div>
              <span className="text-xs text-ink-soft shrink-0">{timeAgo(e.checkedAt)}</span>
            </Row>
          );
        })}
      </div>
    </div>
  );
}
