import { useEffect, useState } from 'react';
import { Building2, CheckCircle2, ExternalLink, PauseCircle, RefreshCw, XCircle } from 'lucide-react';
import Spinner from './Spinner';
import { shortenHash } from './CredentialDNA';
import { useToast } from '../context/ToastContext';
import { listInstitutionsAdmin, setInstitutionStatus } from '../lib/api';

const STATUS_STYLE = {
  approved: 'bg-valid-soft text-valid',
  pending: 'bg-revoked-soft text-revoked',
  rejected: 'bg-invalid-soft text-invalid',
  suspended: 'bg-invalid-soft text-invalid',
};

const KIND_LABEL = {
  university: 'University / college',
  certifying_body: 'Certifying body',
  employer: 'Employer',
  other: 'Other',
};

/**
 * Platform admin view: approve institutions that registered themselves.
 * Approving creates the institution's own issuer wallet and authorizes it on
 * the registry contract; suspending revokes that authorization, so every
 * credential it issued stops verifying as trusted.
 */
export default function InstitutionsPanel() {
  const { notify } = useToast();
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null); // `${id}:${action}`
  const [confirmSuspend, setConfirmSuspend] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      setList(await listInstitutionsAdmin());
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

  const act = async (inst, action) => {
    setBusy(`${inst.id}:${action}`);
    setConfirmSuspend(null);
    try {
      await setInstitutionStatus(inst.id, action);
      notify(
        action === 'approve'
          ? `${inst.name} approved — issuer wallet authorized on-chain.`
          : action === 'suspend'
          ? `${inst.name} suspended — its credentials no longer verify as trusted.`
          : `${inst.name} rejected.`,
        action === 'approve' ? 'success' : 'warning'
      );
      await load();
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setBusy(null);
    }
  };

  const pending = list.filter((i) => i.status === 'pending');
  const others = list.filter((i) => i.status !== 'pending');

  return (
    <div className="bg-card border border-border rounded-lg card-shadow overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-border">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-2">
            <Building2 size={16} className="text-teal" /> Institutions
          </h2>
          <p className="text-xs text-ink-soft">
            {pending.length} awaiting approval · {list.filter((i) => i.status === 'approved').length} approved
          </p>
        </div>
        <button onClick={load} className="text-ink-soft hover:text-ink" aria-label="Refresh institutions">
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {loading && list.length === 0 ? (
        <div className="p-6 flex justify-center">
          <Spinner size={18} />
        </div>
      ) : (
        <div className="divide-y divide-border">
          {[...pending, ...others].map((inst) => (
            <div key={inst.id} className="px-5 py-3.5 flex flex-wrap items-start gap-x-4 gap-y-2">
              <div className="flex-1 min-w-[220px]">
                <p className="text-sm font-medium flex items-center gap-2 flex-wrap">
                  {inst.name}
                  <span className={`text-[11px] font-medium rounded px-1.5 py-0.5 ${STATUS_STYLE[inst.status]}`}>
                    {inst.status}
                  </span>
                </p>
                <p className="text-xs text-ink-soft mt-0.5">
                  {KIND_LABEL[inst.kind] || inst.kind}
                  {inst.credentialCount ? ` · ${inst.credentialCount.toLocaleString()} credentials` : ''}
                  {inst.email && ` · ${inst.email}`}
                  {inst.source && inst.source !== 'registration' && ` · source: ${inst.source}`}
                </p>
                <p className="text-xs text-ink-soft mt-0.5 flex items-center gap-2 flex-wrap">
                  {inst.walletAddress ? (
                    <span className="font-mono">issuer {shortenHash(inst.walletAddress)}</span>
                  ) : (
                    <span>no issuer wallet</span>
                  )}
                  {inst.website && (
                    <a
                      href={inst.website}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-teal hover:underline inline-flex items-center gap-0.5"
                    >
                      website <ExternalLink size={10} />
                    </a>
                  )}
                </p>
              </div>

              <div className="flex gap-2 items-center">
                {(inst.status === 'pending' || inst.status === 'suspended') && inst.source !== 'platform-owner' && (
                  <button
                    onClick={() => act(inst, 'approve')}
                    disabled={Boolean(busy)}
                    className="flex items-center gap-1.5 text-xs font-medium bg-teal text-white rounded-md px-3 py-1.5 hover:bg-teal/90 disabled:opacity-60"
                  >
                    {busy === `${inst.id}:approve` ? <Spinner size={12} /> : <CheckCircle2 size={13} />}
                    Approve
                  </button>
                )}
                {inst.status === 'pending' && (
                  <button
                    onClick={() => act(inst, 'reject')}
                    disabled={Boolean(busy)}
                    className="flex items-center gap-1.5 text-xs font-medium border border-border rounded-md px-3 py-1.5 hover:bg-white disabled:opacity-60"
                  >
                    {busy === `${inst.id}:reject` ? <Spinner size={12} /> : <XCircle size={13} />}
                    Reject
                  </button>
                )}
                {inst.status === 'approved' && inst.source !== 'platform-owner' && inst.walletAddress && (
                  confirmSuspend === inst.id ? (
                    <>
                      <button
                        onClick={() => act(inst, 'suspend')}
                        disabled={Boolean(busy)}
                        className="flex items-center gap-1.5 text-xs font-medium bg-invalid text-white rounded-md px-3 py-1.5 disabled:opacity-60"
                      >
                        {busy === `${inst.id}:suspend` ? <Spinner size={12} /> : <PauseCircle size={13} />}
                        Confirm suspend
                      </button>
                      <button onClick={() => setConfirmSuspend(null)} className="text-xs text-ink-soft hover:text-ink">
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => setConfirmSuspend(inst.id)}
                      className="flex items-center gap-1.5 text-xs font-medium border border-invalid/40 text-invalid rounded-md px-3 py-1.5 hover:bg-invalid-soft"
                    >
                      <PauseCircle size={13} /> Suspend
                    </button>
                  )
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
