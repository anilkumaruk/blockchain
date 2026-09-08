import { ShieldCheck, ShieldAlert, OctagonAlert, SearchX } from 'lucide-react';
import { getStateMeta } from '../lib/verification';

const CONFIG = {
  verified: { Icon: ShieldCheck, text: 'text-valid' },
  revoked: { Icon: ShieldAlert, text: 'text-revoked' },
  mismatch: { Icon: OctagonAlert, text: 'text-invalid' },
  not_found: { Icon: SearchX, text: 'text-invalid' },
};

/**
 * The headline banner for one of the four verification states — always an
 * icon, a bold state title, and a plain-language summary, never color alone.
 */
export default function VerificationStateBanner({ state, align = 'center', size = 'md' }) {
  const cfg = CONFIG[state] || CONFIG.not_found;
  const meta = getStateMeta(state);
  const Icon = cfg.Icon;
  const iconSize = size === 'lg' ? 26 : 18;
  const circleSize = size === 'lg' ? 'w-14 h-14' : 'w-10 h-10';
  const itemsClass = align === 'center' ? 'flex-col items-center text-center' : 'items-start text-left';

  return (
    <div className={`flex gap-3 ${itemsClass}`}>
      <span className={`${circleSize} rounded-full bg-white flex items-center justify-center shrink-0 ${cfg.text}`}>
        <Icon size={iconSize} aria-hidden="true" />
      </span>
      <div>
        <h3 className={`font-semibold tracking-wide ${size === 'lg' ? 'text-lg' : 'text-base'} ${cfg.text}`}>
          {meta.title.toUpperCase()}
        </h3>
        <p className={`text-sm text-ink-soft mt-1 ${align === 'center' ? 'max-w-sm' : ''}`}>
          {meta.summary}
        </p>
      </div>
    </div>
  );
}
