import { useState } from 'react';
import { Copy, Check } from 'lucide-react';

export default function HashChip({ value, label }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable — silently ignore in this demo
    }
  };

  return (
    <div className="flex items-center gap-2 bg-bg border border-border rounded-md px-3 py-2">
      {label && <span className="text-xs text-ink-soft shrink-0">{label}</span>}
      <code className="text-xs text-ink font-mono truncate flex-1" title={value}>
        {value}
      </code>
      <button
        type="button"
        onClick={handleCopy}
        className="shrink-0 text-ink-soft hover:text-teal transition-colors"
        aria-label="Copy to clipboard"
      >
        {copied ? <Check size={14} className="text-valid" /> : <Copy size={14} />}
      </button>
    </div>
  );
}
