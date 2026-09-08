import { Building2, ShieldAlert, CircleCheck } from 'lucide-react';

/**
 * Chronological credential timeline, grouped by issue year (most recent
 * year first). Shared by the private Student Portal and the public
 * Verified Professional Passport so the two never drift apart.
 */
export default function AcademicJourney({ yearGroups, title = 'Academic journey' }) {
  return (
    <div>
      <h2 className="text-base font-semibold mb-3.5">{title}</h2>
      <div className="bg-card border border-border rounded-lg card-shadow p-5 sm:p-6">
        <div className="space-y-6">
          {yearGroups.map(([year, items]) => (
            <div key={year} className="flex gap-4">
              <div className="flex flex-col items-center shrink-0">
                <span className="text-xs font-semibold text-ink-soft w-10 text-right">
                  {year}
                </span>
              </div>
              <div className="flex-1 min-w-0 space-y-4 border-l border-border pl-4 -ml-1">
                {items.map((c) => (
                  <div key={c.credentialId} className="relative">
                    <span
                      className={`absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full ring-4 ring-card ${
                        c.status === 'valid' ? 'bg-valid' : 'bg-revoked'
                      }`}
                    />
                    <p className="text-sm font-medium leading-snug">{c.credentialType}</p>
                    <p className="text-xs text-ink-soft flex items-center gap-1 mt-0.5">
                      <Building2 size={11} />
                      {c.issuer}
                    </p>
                    <p
                      className={`text-xs flex items-center gap-1 mt-0.5 ${
                        c.status === 'valid' ? 'text-valid' : 'text-revoked'
                      }`}
                    >
                      {c.status === 'valid' ? <CircleCheck size={11} /> : <ShieldAlert size={11} />}
                      {c.status === 'valid' ? 'Verified' : 'Revoked'}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
