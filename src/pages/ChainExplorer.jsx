import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Anchor, ArrowDown, Blocks, CheckCircle2, ExternalLink, ShieldAlert, ShieldCheck, Skull, XCircle } from 'lucide-react';
import Spinner from '../components/Spinner';
import { ANCHOR_URL, checkPublicAnchor } from '../lib/publicAnchor';
import { auditChain, getChainBlock, getChainBlocks, getChainSummary, simulateTamper, USE_BACKEND } from '../lib/api';

const PAGE = 12;
const mid = (h) => (h ? `${h.slice(0, 10)}…${h.slice(-6)}` : '—');

function Stat({ label, value }) {
  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
      <p className="text-xs text-ink-soft mt-0.5">{label}</p>
    </div>
  );
}

function Row({ label, children, mono }) {
  return (
    <div className="grid sm:grid-cols-[170px_1fr] gap-x-3 py-1.5 border-b border-border last:border-0 text-sm">
      <dt className="text-ink-soft text-xs sm:text-sm">{label}</dt>
      <dd className={`min-w-0 break-all ${mono ? 'font-mono text-xs' : ''}`}>{children}</dd>
    </div>
  );
}

const Tick = ({ ok }) =>
  ok ? (
    <span className="text-valid inline-flex items-center gap-1"><CheckCircle2 size={14} aria-hidden="true" /> OK</span>
  ) : (
    <span className="text-invalid inline-flex items-center gap-1"><XCircle size={14} aria-hidden="true" /> FAILED</span>
  );

function BlockDetail({ index, onOpen }) {
  const [block, setBlock] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    setBlock(null);
    setError('');
    getChainBlock(index).then(setBlock).catch((e) => setError(e.message));
  }, [index]);
  if (error) return <p className="text-sm text-invalid">{error}</p>;
  if (!block) return <Spinner size={18} />;
  return (
    <div>
      <h2 className="text-base font-semibold mb-3">Block #{block.index}</h2>
      <dl>
        <Row label="Block hash" mono>{block.hash}</Row>
        <Row label="Previous block hash" mono>
          {block.index > 0 ? (
            <button type="button" className="underline text-left break-all" onClick={() => onOpen(block.index - 1)}>{block.previousHash}</button>
          ) : (
            `${block.previousHash} (genesis has no parent)`
          )}
        </Row>
        <Row label="Merkle root" mono>{block.merkleRoot}</Row>
        <Row label="Time">{new Date(block.timestamp).toLocaleString()}</Row>
        <Row label="Proposer">{block.proposer}</Row>
        <Row label="Nonce (proof of work)">{block.nonce.toLocaleString()} (hash must start with {block.difficulty} zeros)</Row>
        <Row label="Validator signatures">{block.signatures} of 3</Row>
        <Row label="Header hashes to block hash"><Tick ok={block.headerHashValid} /></Row>
        <Row label="Transactions give Merkle root"><Tick ok={block.merkleRootValid} /></Row>
        <Row label="Links to previous block"><Tick ok={block.linkValid} /></Row>
        <Row label="Proof of work"><Tick ok={block.powValid} /></Row>
      </dl>
      <h3 className="text-sm font-semibold mt-5 mb-2">{block.txCount} transaction{block.txCount === 1 ? '' : 's'}</h3>
      <ul className="space-y-2">
        {block.transactions.map((t) => (
          <li key={t.id} className="border border-border rounded-md p-3 text-xs">
            <p className="font-semibold mb-1">{t.type}</p>
            <p className="font-mono break-all text-ink-soft">id {t.id}</p>
            <p className="font-mono break-all text-ink-soft">signed by {t.from}</p>
            <pre className="mt-1.5 whitespace-pre-wrap break-all font-mono bg-bg rounded p-2">{JSON.stringify(t.payload, null, 1)}</pre>
          </li>
        ))}
      </ul>
    </div>
  );
}

const ANCHOR_TEXT = {
  match: 'Matches: this chain has not been rewritten since it was anchored.',
  mismatch: 'MISMATCH: the block on this server differs from the hash anchored on Ethereum.',
  none: 'No block hash has been anchored yet.',
  unreachable: 'Could not reach Ethereum Sepolia from this browser.',
};

function PublicAnchor() {
  const [result, setResult] = useState(null);
  useEffect(() => {
    checkPublicAnchor(getChainBlock).then(setResult);
  }, []);
  return (
    <section className="bg-card border border-border rounded-lg p-5">
      <h2 className="text-base font-semibold flex items-center gap-2"><Anchor size={17} aria-hidden="true" /> Public anchor on Ethereum</h2>
      <p className="text-sm text-ink-soft mt-1">
        New block hashes are written to a Solidity smart contract on Ethereum Sepolia. Your browser reads it directly from Ethereum, not through our server.
      </p>
      {!result ? (
        <p className="mt-3 text-sm flex items-center gap-2"><Spinner size={14} /> Reading Ethereum…</p>
      ) : (
        <div className="mt-3 text-sm">
          <p className={`font-medium ${result.status === 'match' ? 'text-valid' : result.status === 'mismatch' ? 'text-invalid' : 'text-ink-soft'}`}>{ANCHOR_TEXT[result.status]}</p>
          {result.hash && (
            <dl className="mt-2">
              <Row label="Anchored block">#{result.blockIndex}</Row>
              <Row label="Hash on Ethereum" mono>{result.hash}</Row>
              <Row label="Anchored at">{new Date(result.anchoredAt).toLocaleString()}</Row>
            </dl>
          )}
        </div>
      )}
      <a href={ANCHOR_URL} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1.5 text-sm text-teal underline">
        View the smart contract on Etherscan <ExternalLink size={13} aria-hidden="true" />
      </a>
    </section>
  );
}

function TamperDemo({ block }) {
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async () => {
    setBusy(true);
    setError('');
    try {
      setResult(await simulateTamper(block));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="bg-card border border-border rounded-lg p-5">
      <h2 className="text-base font-semibold flex items-center gap-2"><Skull size={17} aria-hidden="true" /> Try to forge a certificate</h2>
      <p className="text-sm text-ink-soft mt-1 mb-3">
        Attacks a throwaway copy of the chain from block #{block} onward, trying harder at each step. The real chain is not touched.
      </p>
      <button type="button" onClick={run} disabled={busy} className="text-sm font-medium bg-teal text-white rounded-md px-4 py-2 hover:bg-teal/90 disabled:opacity-60">
        {busy ? 'Attacking the copy…' : 'Run the attack'}
      </button>
      {error && <p className="text-sm text-invalid mt-2">{error}</p>}
      {result && (
        <ol className="mt-4 space-y-2">
          {result.steps.map((s, i) => (
            <li key={s.attempt} className="border border-border rounded-md p-3 text-sm">
              <p className="font-medium">Step {i + 1}: {s.attempt}</p>
              <p className={`mt-1 text-xs font-semibold ${s.detected ? 'text-valid' : 'text-invalid'}`}>{s.detected ? 'Detected' : 'NOT detected'}</p>
              <ul className="mt-1 list-disc pl-4 text-xs text-ink-soft font-mono break-words">
                {s.problems.map((p) => <li key={p}>{p}</li>)}
              </ul>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export default function ChainExplorer() {
  const [params, setParams] = useSearchParams();
  const [summary, setSummary] = useState(null);
  const [list, setList] = useState(null);
  const [from, setFrom] = useState(undefined);
  const [audit, setAudit] = useState(null);
  const [auditing, setAuditing] = useState(false);
  const [error, setError] = useState('');
  const selected = params.get('block') == null ? null : Number(params.get('block'));
  const open = useCallback((i) => setParams({ block: String(i) }), [setParams]);

  useEffect(() => {
    if (!USE_BACKEND) return;
    getChainSummary().then(setSummary).catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (!USE_BACKEND) return;
    getChainBlocks(from, PAGE).then(setList).catch((e) => setError(e.message));
  }, [from]);

  const runAudit = async () => {
    setAuditing(true);
    setError('');
    try {
      setAudit(await auditChain());
    } catch (e) {
      setError(e.message);
    } finally {
      setAuditing(false);
    }
  };

  if (!USE_BACKEND) return <p className="max-w-3xl mx-auto p-8 text-sm text-ink-soft">The blockchain explorer needs the Chain of Record server.</p>;
  if (error && !summary) return <p className="max-w-3xl mx-auto p-8 text-sm text-invalid">{error}</p>;
  if (!summary || !list) return <div className="flex justify-center py-16"><Spinner size={22} /></div>;

  const oldest = list.blocks.at(-1)?.index ?? 0;
  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-5 py-8 space-y-6">
      <header>
        <h1 className="text-xl font-semibold flex items-center gap-2"><Blocks size={20} aria-hidden="true" /> Blockchain explorer</h1>
        <p className="text-sm text-ink-soft mt-1 max-w-3xl">
          Every block of this project's own blockchain. Each block stores the hash of the block before it, so changing any old block breaks every link after it.
        </p>
      </header>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Blocks" value={summary.blocks.toLocaleString()} />
        <Stat label="Transactions" value={summary.transactions.toLocaleString()} />
        <Stat label="Certificates on chain" value={summary.certificates.toLocaleString()} />
        <Stat label="Revoked" value={summary.revoked.toLocaleString()} />
      </div>

      <section className="bg-card border border-border rounded-lg p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <div>
            <h2 className="text-base font-semibold">Validator nodes</h2>
            <p className="text-xs text-ink-soft">{summary.quorum} of {summary.nodes.length} must approve each block. Each keeps its own copy of the chain.</p>
          </div>
          <button type="button" onClick={runAudit} disabled={auditing} className="text-sm border border-border rounded-md px-3 py-1.5 hover:bg-teal-soft/50 disabled:opacity-60">
            {auditing ? 'Re-checking every block…' : 'Re-validate the whole chain'}
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[520px]">
            <thead className="text-xs text-ink-soft text-left">
              <tr><th className="py-1.5 pr-3 font-medium">Node</th><th className="pr-3 font-medium">Blocks</th><th className="pr-3 font-medium">Latest hash</th><th className="font-medium">Integrity</th></tr>
            </thead>
            <tbody>
              {summary.nodes.map((n) => {
                const a = audit?.find((x) => x.node === n.id);
                const valid = a ? a.valid : n.valid;
                return (
                  <tr key={n.id} className="border-t border-border">
                    <td className="py-1.5 pr-3 font-medium">{n.id}</td>
                    <td className="pr-3 tabular-nums">{n.height + 1}</td>
                    <td className="pr-3 font-mono text-xs">{mid(n.head)}</td>
                    <td className={valid ? 'text-valid' : 'text-invalid'}>
                      <span className="inline-flex items-center gap-1">
                        {valid ? <ShieldCheck size={14} aria-hidden="true" /> : <ShieldAlert size={14} aria-hidden="true" />}
                        {valid ? (a ? 'Fully re-validated' : 'Valid') : `Invalid at block ${a?.invalidAt ?? ''}: ${a?.problem ?? n.problem}`}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {error && <p className="text-sm text-invalid mt-2">{error}</p>}
      </section>

      <PublicAnchor />

      <div className="grid lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] gap-5 items-start">
        <section>
          <h2 className="text-base font-semibold mb-3">The chain (newest first)</h2>
          <ol>
            {list.blocks.map((b, i) => (
              <li key={b.hash}>
                <button
                  type="button"
                  onClick={() => open(b.index)}
                  aria-current={selected === b.index}
                  className={`w-full text-left bg-card border rounded-lg p-3 hover:border-teal/50 ${selected === b.index ? 'border-teal ring-1 ring-teal/30' : 'border-border'}`}
                >
                  <span className="flex items-center justify-between gap-2 text-sm">
                    <span className="font-semibold">Block #{b.index}</span>
                    <span className="text-xs text-ink-soft">{b.txCount} tx · {b.types.join(', ')}</span>
                  </span>
                  <span className="block font-mono text-[11px] text-ink-soft mt-1 break-all">hash {mid(b.hash)}</span>
                  <span className="block font-mono text-[11px] text-ink-soft break-all">prev {mid(b.previousHash)}</span>
                </button>
                {i < list.blocks.length - 1 && (
                  <div className="flex items-center gap-1.5 text-[10px] text-ink-soft py-1 pl-4">
                    <ArrowDown size={12} aria-hidden="true" /> its "prev" is this block's hash
                  </div>
                )}
              </li>
            ))}
          </ol>
          <div className="flex justify-between mt-3 text-sm">
            <button type="button" disabled={from == null} onClick={() => { const next = (from ?? 0) + PAGE; setFrom(next >= list.total - 1 ? undefined : next); }} className="border border-border rounded-md px-3 py-1 disabled:opacity-40">Newer</button>
            <span className="text-xs text-ink-soft self-center">{list.total} blocks</span>
            <button type="button" disabled={oldest === 0} onClick={() => setFrom(oldest - 1)} className="border border-border rounded-md px-3 py-1 disabled:opacity-40">Older</button>
          </div>
        </section>
        <div className="space-y-5 min-w-0">
          <section className="bg-card border border-border rounded-lg p-5">
            {selected == null ? <p className="text-sm text-ink-soft">Select a block to see inside it.</p> : <BlockDetail index={selected} onOpen={open} />}
          </section>
          <TamperDemo block={selected != null && selected > 1 ? selected : 2} />
        </div>
      </div>
    </div>
  );
}
