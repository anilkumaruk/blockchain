import { useEffect, useState } from 'react';
import { Blocks, ExternalLink, FileCheck2, KeyRound, Link2, ShieldCheck } from 'lucide-react';
import Spinner from '../components/Spinner';
import { CHAIN, addressLink, txLink } from '../lib/wallet';
import { blockDetails, contractOverview } from '../lib/chainVerify';

const mid = (h) => (h ? `${String(h).slice(0, 10)}…${String(h).slice(-6)}` : '—');

function Stat({ label, value }) {
  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <p className="text-2xl font-semibold tabular-nums break-all">{value}</p>
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

const Ext = ({ href, children }) =>
  href ? (
    <a href={href} target="_blank" rel="noreferrer" className="text-teal hover:underline inline-flex items-center gap-1">
      {children} <ExternalLink size={12} aria-hidden="true" />
    </a>
  ) : (
    children
  );

const EVENT_TEXT = {
  IssuerUpdated: (a) => `${a.active === 'true' ? 'Authorised' : 'Deauthorised'} issuer ${a.name}`,
  CredentialIssued: (a) => `Issued credential ${a.credentialId}`,
  BatchAnchored: (a) => `Merkle batch #${a.batchId}: ${a.count} certificates under one root`,
  CredentialRevoked: (a) => `Revoked credential ${a.credentialId}`,
};

const STEPS = [
  [FileCheck2, 'Hash the certificate', 'SHA-256 of its canonical line and every semester row: the docHash.'],
  [KeyRound, 'University signs in MetaMask', 'issueCredential (one) or anchorBatch (a Merkle root for many) is sent to the smart contract.'],
  [Blocks, 'Ethereum mines it into a block', 'Every block stores the hash of its parent, so changing an old block breaks every block after it.'],
  [ShieldCheck, 'Anyone verifies', 'Read the contract: is this exact hash recorded, by an authorised issuer, and not revoked?'],
];

function BlockPanel({ number, onClose }) {
  const [block, setBlock] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    blockDetails(number).then(setBlock).catch((e) => setError(e.message));
  }, [number]);
  return (
    <section className="bg-card border border-border rounded-lg p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold">Block #{number.toLocaleString()}</h2>
        <button onClick={onClose} className="text-xs text-ink-soft hover:text-ink">Close</button>
      </div>
      {error && <p className="text-sm text-invalid">{error}</p>}
      {!block && !error && <Spinner size={18} />}
      {block && (
        <dl>
          <Row label="Block hash" mono>{block.hash}</Row>
          <Row label="Parent block hash" mono>{block.parentHash}</Row>
          <Row label="Time">{new Date(block.timestamp * 1000).toLocaleString()}</Row>
          <Row label="Transactions in block">{block.transactions}</Row>
          <Row label="Gas used">{Number(block.gasUsed).toLocaleString()}</Row>
          <Row label="Validator (fee recipient)" mono>{block.miner}</Row>
        </dl>
      )}
      <p className="text-xs text-ink-soft mt-3">
        The parent hash links this block to the one before it. Read directly from Ethereum {CHAIN.network}, not from the Chain of Record server.
      </p>
    </section>
  );
}

export default function ChainExplorer() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [block, setBlock] = useState(null);

  useEffect(() => {
    contractOverview().then(setData).catch((e) => setError(e.message || 'Could not reach Ethereum.'));
  }, []);

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-5 py-8 space-y-6">
      <header>
        <h1 className="text-xl font-semibold flex items-center gap-2"><Blocks size={20} aria-hidden="true" /> Blockchain</h1>
        <p className="text-sm text-ink-soft mt-1 max-w-3xl">
          Certificates are recorded in the <span className="font-medium text-ink">CredentialRegistry</span> smart contract on Ethereum{' '}
          {CHAIN.network === 'sepolia' ? 'Sepolia (public test network)' : `(${CHAIN.network})`}. This page reads it straight from Ethereum in your browser.
        </p>
      </header>

      <ol className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {STEPS.map(([Icon, title, text], i) => (
          <li key={title} className="bg-card border border-border rounded-lg p-4">
            <p className="text-xs text-ink-soft">Step {i + 1}</p>
            <p className="font-medium flex items-center gap-1.5 mt-0.5"><Icon size={15} className="text-teal" aria-hidden="true" /> {title}</p>
            <p className="text-xs text-ink-soft mt-1">{text}</p>
          </li>
        ))}
      </ol>

      {error && <p className="text-sm text-invalid">{error}</p>}
      {!data && !error && <div className="flex justify-center py-12"><Spinner size={22} /></div>}
      {data && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Stat label="Certificates recorded" value={data.totalIssued.toLocaleString()} />
            <Stat label="Revoked" value={data.totalRevoked.toLocaleString()} />
            <Stat label="Merkle batches" value={data.batchCount.toLocaleString()} />
            <Stat label="Latest Ethereum block" value={data.latestBlock.toLocaleString()} />
          </div>

          <section className="bg-card border border-border rounded-lg p-5">
            <h2 className="font-semibold mb-2">Smart contract</h2>
            <dl>
              <Row label="Contract address" mono><Ext href={addressLink(data.contract)}>{data.contract}</Ext></Row>
              <Row label="Owner (platform)" mono>{data.owner}</Row>
              <Row label="Network">{data.network}</Row>
              <Row label="Deployed in block">{data.deploymentBlock.toLocaleString()}</Row>
              <Row label="Status">{data.paused ? 'Paused (issuing and revoking stopped)' : 'Active'}</Row>
            </dl>
          </section>

          {block != null && <BlockPanel number={block} onClose={() => setBlock(null)} />}

          <section className="bg-card border border-border rounded-lg p-5">
            <h2 className="font-semibold mb-1">Latest contract events</h2>
            <p className="text-xs text-ink-soft mb-3">Every issue, batch, revocation and issuer change is an event in a mined block. Open a block to see its hash and parent hash.</p>
            {data.events.length === 0 ? (
              <p className="text-sm text-ink-soft">No events yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-ink-soft border-b border-border">
                      <th className="py-2 pr-3">Event</th>
                      <th className="py-2 pr-3">Block</th>
                      <th className="py-2 pr-3">Confirmations</th>
                      <th className="py-2">Transaction</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.events.map((e) => (
                      <tr key={`${e.txHash}-${e.name}-${e.args.credentialId ?? e.args.batchId ?? e.args.issuer}`} className="border-b border-border last:border-0">
                        <td className="py-2 pr-3">{EVENT_TEXT[e.name]?.(e.args) ?? e.name}</td>
                        <td className="py-2 pr-3">
                          <button onClick={() => setBlock(e.blockNumber)} className="text-teal hover:underline inline-flex items-center gap-1">
                            <Link2 size={12} aria-hidden="true" /> #{e.blockNumber.toLocaleString()}
                          </button>
                        </td>
                        <td className="py-2 pr-3 tabular-nums">{e.confirmations.toLocaleString()}</td>
                        <td className="py-2 font-mono text-xs"><Ext href={txLink(e.txHash)}>{mid(e.txHash)}</Ext></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
