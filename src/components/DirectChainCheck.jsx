import { useEffect, useState } from 'react';
import { CheckCircle2, ExternalLink, ShieldAlert, ShieldCheck, XCircle } from 'lucide-react';
import Spinner from './Spinner';
import { verifyFromQr } from '../lib/chainVerify';
import { addressLink, txLink } from '../lib/wallet';

const TONE = {
  valid: { Icon: ShieldCheck, title: 'VALID', cls: 'border-valid/40 bg-valid/5 text-valid' },
  revoked: { Icon: ShieldAlert, title: 'REVOKED', cls: 'border-amber-400/50 bg-amber-50 text-amber-700' },
  invalid: { Icon: XCircle, title: 'INVALID', cls: 'border-invalid/40 bg-invalid/5 text-invalid' },
};

/**
 * Opened from a marks card's QR link: checks the certificate in the browser
 * only - IPFS for the document, Ethereum for the hash and status - without
 * asking the Chain of Record server anything.
 */
export default function DirectChainCheck({ qr }) {
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    verifyFromQr(qr).then(setResult).catch((e) => setError(e.message || 'The check could not be completed.'));
  }, [qr]);

  return (
    <section className="bg-card border border-border rounded-lg p-5 mb-6 card-shadow">
      <p className="text-[11px] font-semibold tracking-[0.12em] text-teal uppercase mb-1">Checked without our server</p>
      <h2 className="font-semibold mb-1">Certificate {qr.certificateNo}</h2>
      <p className="text-xs text-ink-soft mb-4">
        Your browser fetched the encrypted certificate from IPFS, decrypted it with the key in the QR code, and read the smart contract on Ethereum directly.
      </p>
      {error && <p className="text-sm text-invalid">{error} No verdict is shown without the blockchain.</p>}
      {!result && !error && (
        <p className="text-sm text-ink-soft flex items-center gap-2"><Spinner size={15} /> Reading IPFS and Ethereum…</p>
      )}
      {result && (
        <>
          {(() => {
            const { Icon, title, cls } = TONE[result.verdict];
            return (
              <div className={`border rounded-lg p-4 flex items-start gap-3 ${cls}`}>
                <Icon size={26} aria-hidden="true" />
                <div>
                  <p className="text-lg font-bold">{title}</p>
                  <p className="text-sm text-ink">{result.reason}</p>
                </div>
              </div>
            );
          })()}
          {result.document?.view && (
            <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-1 text-sm mt-4">
              {[
                ['Name', result.document.view.name],
                ['Register No', result.document.view.registerNo],
                ['University', result.document.view.university],
                ['Degree', [result.document.view.degree, result.document.view.branch].filter(Boolean).join(' – ')],
                ['CGPA / %', result.document.view.score],
                ['Year of passing', result.document.view.year],
              ]
                .filter(([, v]) => v)
                .map(([k, v]) => (
                  <div key={k} className="flex gap-2"><dt className="text-ink-soft w-32 shrink-0">{k}</dt><dd className="font-medium">{v}</dd></div>
                ))}
            </dl>
          )}
          <ol className="mt-4 space-y-1.5">
            {result.steps.map((s) => (
              <li key={s.label} className="text-sm flex gap-2">
                {s.ok ? <CheckCircle2 size={16} className="text-valid shrink-0 mt-0.5" aria-label="passed" /> : <XCircle size={16} className="text-invalid shrink-0 mt-0.5" aria-label="failed" />}
                <span>
                  {s.label}
                  {s.detail && <span className="block font-mono text-[11px] text-ink-soft break-all">{s.detail}</span>}
                </span>
              </li>
            ))}
          </ol>
          <p className="text-xs text-ink-soft mt-4 flex flex-wrap gap-x-4 gap-y-1">
            <span>Network: {result.chain.network}</span>
            {result.chain.contract && (
              <a className="text-teal hover:underline inline-flex items-center gap-1" href={addressLink(result.chain.contract) ?? undefined} target="_blank" rel="noreferrer">
                Contract <ExternalLink size={11} aria-hidden="true" />
              </a>
            )}
            {result.chain.txHash && (
              <a className="text-teal hover:underline inline-flex items-center gap-1" href={txLink(result.chain.txHash) ?? undefined} target="_blank" rel="noreferrer">
                Transaction <ExternalLink size={11} aria-hidden="true" />
              </a>
            )}
          </p>
        </>
      )}
    </section>
  );
}
