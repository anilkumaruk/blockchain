import { NavLink } from 'react-router-dom';
import { Link2, ShieldCheck, GraduationCap, Building2 } from 'lucide-react';

const ROLES = [
  { to: '/admin', label: 'Admin', icon: ShieldCheck },
  { to: '/student', label: 'Student', icon: GraduationCap },
  { to: '/verify', label: 'Employer / Verifier', icon: Building2 },
];

export default function TopNav() {
  return (
    <header className="sticky top-0 z-40 bg-card border-b border-border">
      <div className="max-w-6xl mx-auto px-5 h-16 flex items-center justify-between gap-4">
        <NavLink to="/" className="flex items-center gap-2.5 shrink-0">
          <span className="w-8 h-8 rounded-lg bg-teal flex items-center justify-center">
            <Link2 size={17} className="text-white" strokeWidth={2.5} />
          </span>
          <span className="font-semibold text-[15px] tracking-tight">Chain of Record</span>
        </NavLink>

        <nav className="flex items-center gap-1 bg-bg rounded-lg p-1 border border-border">
          {ROLES.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-white text-teal card-shadow'
                    : 'text-ink-soft hover:text-ink'
                }`
              }
            >
              <Icon size={15} />
              <span className="hidden sm:inline">{label}</span>
            </NavLink>
          ))}
        </nav>
      </div>
    </header>
  );
}
