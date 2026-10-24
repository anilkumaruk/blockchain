import { useEffect, useState } from 'react';
import { PauseCircle, PlayCircle, RefreshCw, ShieldCheck } from 'lucide-react';
import Spinner from './Spinner';
import { shortenHash } from './CredentialDNA';
import { useToast } from '../context/ToastContext';
import { getAuditLog, getRegistryStatus, setRegistryPaused } from '../lib/api';

const ACTION_LABELS = {
  login: 'Signed in',
  login_failed: 'Failed sign-in',
  credential_issued: 'Issued credential',
  credential_revoked: 'Revoked credential',
  credential_reissued: 'Reissued credential',
  batch_anchored: 'Anchored batch',
  registry_paused: 'Paused registry',
  registry_unpaused: 'Resumed registry',
};

export default function SecurityPanel() {
  const { notify } = useToast();
  const [registry, setRegistry] = useState(null);
  const [log, setLog] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [status, entries] = await Promise.all([getRegistryStatus(), getAuditLog(50)]);
      setRegistry(status);
      setLog(entries);
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const togglePause = async () => {
    setToggling(true);
    try {
      const res = await setRegistryPaused(!registry.paused);
      notify(res.paused ? 'Registry paused: issuance is disabled.' : 'Registry resumed.', 'warning');
      await load();
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setToggling(false);
    }
  };

  return (
    <div className="grid lg:grid-cols-[1fr_2fr] gap-5">
      <div className="bg-card border border-border rounded-lg card-shadow p-5 sm:p-6 h-fit">
        <div className="flex items-center gap-2 mb-3">
          <ShieldCheck size={17} className="text-teal" />
          <h2 className="text-base font-semibold">Registry contract</h2>
        </div>
        {loading && !registry ? (
          <Spinner size={18} />
        ) : registry ? (
          <>
            <dl className="text-xs space-y-2 mb-4">
              <div>
                <dt className="text-ink-soft">Contract</dt>
                <dd className="font-mono break-all">{registry.contract}</dd>
              </div>
              <div>
                <dt className="text-ink-soft">Owner</dt>
                <dd className="font-mono break-all">{registry.owner}</dd>
              </div>
              <div>
                <dt className="text-ink-soft">Status</dt>
                <dd className={registry.paused ? 'text-revoked font-medium' : 'text-valid font-medium'}>
                  {registry.paused ? 'Paused — issuance and revocation disabled' : 'Active'}
                </dd>
              </div>
            </dl>
            <p className="text-xs text-ink-soft mb-3">
              Emergency stop for a suspected key compromise. Verification keeps working while paused.
            </p>
            <button
              onClick={togglePause}
              disabled={toggling}
              className={`w-full flex items-center justify-center gap-2 text-sm font-medium rounded-md py-2 border disabled:opacity-60 ${
                registry.paused
                  ? 'bg-teal text-white border-teal hover:bg-teal/90'
                  : 'border-invalid/40 text-invalid hover:bg-invalid-soft'
              }`}
            >
              {toggling ? <Spinner size={15} /> : registry.paused ? <PlayCircle size={15} /> : <PauseCircle size={15} />}
              {registry.paused ? 'Resume registry' : 'Pause registry'}
            </button>
          </>
        ) : null}
      </div>

      <div className="bg-card border border-border rounded-lg card-shadow overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div>
            <h2 className="text-base font-semibold">Audit log</h2>
            <p className="text-xs text-ink-soft">Append-only record of sign-ins and registry actions.</p>
          </div>
          <button onClick={load} className="text-ink-soft hover:text-ink" aria-label="Refresh audit log">
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
        <div className="divide-y divide-border max-h-96 overflow-y-auto text-sm">
          {log.length === 0 && !loading && <p className="px-5 py-6 text-ink-soft text-sm">No entries yet.</p>}
          {log.map((e) => (
            <div key={e.id} className="px-5 py-2.5 grid grid-cols-[1fr_auto] gap-x-3">
              <span className={e.action === 'login_failed' ? 'text-invalid' : ''}>
                {ACTION_LABELS[e.action] || e.action}
                {e.target && <span className="font-mono text-xs text-ink-soft"> · {e.target}</span>}
              </span>
              <span className="text-xs text-ink-soft">{new Date(e.at).toLocaleString()}</span>
              <span className="text-xs text-ink-soft">
                {e.actor || 'unknown'} · {e.ip || '—'}
                {e.details?.txHash && <span className="font-mono"> · tx {shortenHash(e.details.txHash)}</span>}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
