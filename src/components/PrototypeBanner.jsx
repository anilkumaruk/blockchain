import { Info } from 'lucide-react';
import { USE_BACKEND } from '../lib/api';

export default function PrototypeBanner() {
  return (
    <div className="border-t border-border bg-teal-soft">
      <div className="max-w-6xl mx-auto px-5 py-2.5 flex items-center gap-2 text-xs text-teal">
        <Info size={14} className="shrink-0" />
        <span>
          {USE_BACKEND
            ? 'Connected to the Chain of Record server. Certificates are recorded on the project blockchain; see every block on the Blockchain page.'
            : 'This is a frontend prototype for a B.Tech CSE academic project — all blockchain transactions and database calls are simulated in-browser, no real chain or server is involved.'}
        </span>
      </div>
    </div>
  );
}
