import { useState } from 'react';
import { Layers, Upload } from 'lucide-react';
import Spinner from './Spinner';
import { shortenHash } from './CredentialDNA';
import { useToast } from '../context/ToastContext';
import { issueBatch } from '../lib/api';

const SAMPLE = `studentName,studentId,credentialType,issueDate
Ananya Sharma,AU24CS0001,B.Tech in Computer Science & Engineering,2026-06-15
Rahul Menon,AU24CS0002,B.Tech in Computer Science & Engineering,2026-06-15
Divya Rao,AU24IT0003,B.Tech in Information Technology,2026-06-15`;

const COLUMNS = ['studentName', 'studentId', 'credentialType', 'issueDate'];

// Minimal CSV parsing: one record per line, comma-separated, no quoting.
// Course names in this system don't contain commas.
function parseCsv(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];
  const hasHeader = lines[0].toLowerCase().startsWith('studentname');
  return lines.slice(hasHeader ? 1 : 0).map((line, i) => {
    const cells = line.split(',').map((c) => c.trim());
    if (cells.length < 3) throw new Error(`Line ${i + 1 + (hasHeader ? 1 : 0)}: expected at least 3 columns.`);
    return Object.fromEntries(COLUMNS.map((col, j) => [col, cells[j] || undefined]));
  });
}

export default function BatchIssuePanel({ onIssued }) {
  const { notify } = useToast();
  const [csv, setCsv] = useState(SAMPLE);
  const [issuing, setIssuing] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  let rows = [];
  let parseError = '';
  try {
    rows = parseCsv(csv);
  } catch (err) {
    parseError = err.message;
  }

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (file) setCsv(await file.text());
  };

  const handleIssue = async () => {
    setError('');
    setIssuing(true);
    try {
      const res = await issueBatch(rows);
      setResult(res);
      notify(`Batch #${res.batchId}: ${res.count} credentials anchored in one transaction.`, 'success');
      onIssued();
    } catch (err) {
      setError(err.message);
    } finally {
      setIssuing(false);
    }
  };

  return (
    <div className="bg-card border border-border rounded-lg card-shadow p-6 sm:p-7 max-w-3xl">
      <div className="flex items-center gap-2 mb-1">
        <Layers size={17} className="text-teal" />
        <h2 className="text-base font-semibold">Batch issuance (Merkle tree)</h2>
      </div>
      <p className="text-sm text-ink-soft mb-5">
        Issue a whole graduating class in one blockchain transaction. Each certificate is hashed,
        the hashes form a Merkle tree, and only the 32-byte root is written on-chain. Every student
        keeps a short proof that links their certificate to that root.
      </p>

      {result ? (
        <div className="space-y-4">
          <div className="rounded-md border border-valid/30 bg-valid-soft p-4 text-sm">
            <p className="font-medium text-valid mb-2">
              Batch #{result.batchId} anchored — {result.count} credentials, 1 transaction
            </p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
              <dt className="text-ink-soft">Merkle root</dt>
              <dd className="font-mono break-all">{result.root}</dd>
              <dt className="text-ink-soft">Transaction</dt>
              <dd className="font-mono break-all">{result.txHash}</dd>
              <dt className="text-ink-soft">Gas used</dt>
              <dd>
                {Number(result.gasUsed).toLocaleString()} total ·{' '}
                {Math.round(Number(result.gasUsed) / result.count).toLocaleString()} per credential
              </dd>
            </dl>
          </div>
          <div className="border border-border rounded-md divide-y divide-border text-sm max-h-64 overflow-y-auto">
            {result.credentials.map((c) => (
              <div key={c.credentialId} className="flex justify-between gap-3 px-3 py-2">
                <span className="font-mono">{c.credentialId}</span>
                <span className="font-mono text-ink-soft">{shortenHash(c.hash)}</span>
              </div>
            ))}
          </div>
          <button
            onClick={() => setResult(null)}
            className="text-sm border border-border rounded-md px-3 py-1.5 hover:bg-white"
          >
            Issue another batch
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-ink-soft">
              CSV: studentName, studentId, credentialType, issueDate (YYYY-MM-DD)
            </label>
            <label className="flex items-center gap-1.5 text-xs text-teal cursor-pointer hover:underline">
              <Upload size={13} /> Load .csv
              <input type="file" accept=".csv,text/csv" className="hidden" onChange={handleFile} />
            </label>
          </div>
          <textarea
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
            rows={8}
            spellCheck={false}
            className="w-full rounded-md border border-border bg-white px-3 py-2 text-xs font-mono outline-none focus:ring-2 focus:ring-teal/30 focus:border-teal"
          />
          {(parseError || error) && <p className="text-xs text-invalid">{parseError || error}</p>}
          <div className="flex items-center justify-between">
            <p className="text-xs text-ink-soft">{parseError ? '' : `${rows.length} credential(s) ready`}</p>
            <button
              onClick={handleIssue}
              disabled={issuing || Boolean(parseError) || rows.length === 0}
              className="flex items-center gap-2 bg-teal text-white text-sm font-medium rounded-md px-4 py-2 hover:bg-teal/90 disabled:opacity-60"
            >
              {issuing ? <Spinner size={15} /> : <Layers size={15} />}
              {issuing ? 'Anchoring…' : `Issue ${rows.length} in one transaction`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
