import { CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';

const CONFIG = {
  valid: {
    label: 'Valid',
    icon: CheckCircle2,
    className: 'bg-valid-soft text-valid',
  },
  invalid: {
    label: 'Invalid',
    icon: XCircle,
    className: 'bg-invalid-soft text-invalid',
  },
  revoked: {
    label: 'Revoked',
    icon: AlertTriangle,
    className: 'bg-revoked-soft text-revoked',
  },
};

export default function StatusBadge({ status, size = 'md' }) {
  const cfg = CONFIG[status] || CONFIG.invalid;
  const Icon = cfg.icon;
  const sizing =
    size === 'sm'
      ? 'text-xs px-2 py-0.5 gap-1'
      : 'text-sm px-2.5 py-1 gap-1.5';
  const iconSize = size === 'sm' ? 12 : 14;

  return (
    <span
      className={`inline-flex items-center rounded-full font-medium ${sizing} ${cfg.className}`}
    >
      <Icon size={iconSize} strokeWidth={2.5} />
      {cfg.label}
    </span>
  );
}
