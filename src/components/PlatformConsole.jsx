import { useEffect, useState } from 'react';
import { Building2, ShieldHalf } from 'lucide-react';
import InstitutionsPanel from './InstitutionsPanel';
import SecurityPanel from './SecurityPanel';
import { listInstitutionsAdmin } from '../lib/api';

/**
 * Console for the platform administrator. The platform admin belongs to no
 * university: it approves or suspends institutions and runs the registry's
 * security controls, but never sees, issues or revokes a university's
 * credentials - each university (Alliance University included) does that
 * from its own Credential Center.
 */
export default function PlatformConsole({ onSignOut }) {
  const [tab, setTab] = useState('institutions');
  const [summary, setSummary] = useState(null);

  useEffect(() => {
    listInstitutionsAdmin()
      .then((list) => {
        const issuers = list.filter((i) => i.kind !== 'employer');
        setSummary({
          approved: issuers.filter((i) => i.status === 'approved').length,
          pending: list.filter((i) => i.status === 'pending').length,
          suspended: list.filter((i) => i.status === 'suspended').length,
          credentials: list.reduce((n, i) => n + (i.credentialCount ?? 0), 0),
        });
      })
      .catch(() => setSummary(null));
  }, [tab]);

  const stats = summary
    ? [
        ['Approved universities', summary.approved],
        ['Awaiting approval', summary.pending],
        ['Suspended', summary.suspended],
        ['Credentials on-chain', summary.credentials],
      ]
    : [];

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-5 py-8 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.14em] text-teal uppercase mb-1">Chain of Record</p>
          <h1 className="text-xl font-semibold">Platform Administration</h1>
          <p className="text-sm text-ink-soft mt-0.5">
            Approve universities and manage the registry. Credentials are issued and managed by each university.
          </p>
        </div>
        <button
          onClick={onSignOut}
          className="text-sm text-ink-soft hover:text-ink border border-border rounded-md px-3 py-1.5 shrink-0"
        >
          Sign out
        </button>
      </div>

      {summary && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {stats.map(([label, value]) => (
            <div key={label} className="bg-card border border-border rounded-lg card-shadow p-4">
              <p className="text-2xl font-semibold">{value.toLocaleString()}</p>
              <p className="text-xs text-ink-soft">{label}</p>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-1 bg-white border border-border rounded-lg p-1 w-fit max-w-full">
        {[
          ['institutions', 'Institutions', Building2],
          ['security', 'Registry & audit', ShieldHalf],
        ].map(([key, label, Icon]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-md text-sm font-medium transition-colors ${
              tab === key ? 'bg-teal text-white' : 'text-ink-soft hover:text-ink'
            }`}
          >
            <Icon size={15} />
            {label}
          </button>
        ))}
      </div>

      {tab === 'institutions' ? <InstitutionsPanel /> : <SecurityPanel />}
    </div>
  );
}
