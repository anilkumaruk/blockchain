import { useEffect, useState } from 'react';
import { History } from 'lucide-react';
import { shortenHash } from './CredentialDNA';
import { getCredentialHistory } from '../lib/api';

const LABELS = {
  issued: 'Issued on-chain',
  batch_anchored: 'Anchored in Merkle batch',
  revoked: 'Revoked on-chain',
};

/**
 * Lists the registry's events for one credential, read straight from the
 * blockchain (backend mode only). Revocation never deletes the issuance
 * event, so the full issue -> revoke trail is always visible here.
 */
export default function OnChainHistory({ credentialId }) {
  const [events, setEvents] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    getCredentialHistory(credentialId)
      .then((res) => !cancelled && setEvents(res.events))
      .catch((err) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [credentialId]);

  return (
    <div className="border-t border-border pt-4">
      <p className="text-[11px] text-ink-soft mb-2 flex items-center gap-1">
        <History size={11} aria-hidden="true" />
        On-chain audit trail
      </p>
      {error && <p className="text-xs text-invalid">{error}</p>}
      {!events && !error && <p className="text-xs text-ink-soft">Reading registry events…</p>}
      {events && (
        <ol className="space-y-2">
          {events.map((e) => (
            <li key={`${e.txHash}-${e.type}`} className="text-xs grid grid-cols-[auto_1fr] gap-x-2">
              <span
                className={`mt-1 w-2 h-2 rounded-full ${e.type === 'revoked' ? 'bg-revoked' : 'bg-valid'}`}
                aria-hidden="true"
              />
              <span>
                <span className="font-medium">
                  {LABELS[e.type] || e.type}
                  {e.batchId ? ` #${e.batchId}` : ''}
                </span>
                <span className="text-ink-soft"> · {new Date(e.at).toLocaleString()} · block {e.blockNumber}</span>
                <span className="block font-mono text-ink-soft break-all">tx {shortenHash(e.txHash)}</span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
