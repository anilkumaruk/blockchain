import { Check, X, AlertTriangle } from 'lucide-react';

const TONE = {
  pass: { wrap: 'bg-valid-soft text-valid', Icon: Check, word: 'Passed' },
  fail: { wrap: 'bg-invalid-soft text-invalid', Icon: X, word: 'Failed' },
  warn: { wrap: 'bg-revoked-soft text-revoked', Icon: AlertTriangle, word: 'Attention' },
};

/**
 * Renders the "Verification checks" checklist. Every check pairs an icon
 * with a text label and an sr-only status word, so the result is never
 * communicated by color alone.
 */
export default function VerificationChecks({ checks, passed, total }) {
  return (
    <div>
      <p className="text-xs font-medium text-ink-soft mb-2">Verification checks</p>
      <ul className="space-y-1.5 mb-2.5">
        {checks.map((c) => {
          const tone = TONE[c.tone] || (c.passed ? TONE.pass : TONE.fail);
          const Icon = tone.Icon;
          return (
            <li key={c.label} className="flex items-center gap-2 text-sm">
              <span className={`w-4 h-4 rounded-full flex items-center justify-center shrink-0 ${tone.wrap}`}>
                <Icon size={10} strokeWidth={3} aria-hidden="true" />
                <span className="sr-only">{tone.word}:</span>
              </span>
              <span className={c.passed ? 'text-ink' : 'text-ink-soft'}>{c.label}</span>
            </li>
          );
        })}
      </ul>
      <p className="text-xs font-semibold text-ink">
        {passed} / {total} checks passed
      </p>
    </div>
  );
}
