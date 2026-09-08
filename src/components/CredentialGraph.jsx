import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  GraduationCap,
  Building2,
  ShieldAlert,
  Check,
  Waypoints,
  ListTree,
  LayoutGrid,
  RotateCcw,
  ArrowUpRight,
  Eye,
  X,
  CalendarDays,
  Hash,
} from 'lucide-react';
import CredentialDNA from './CredentialDNA';
import VerificationProofModal from './VerificationProofModal';
import { buildCredentialGraph, orderChronologically } from '../lib/credentialGraph';

const VIEW_MODES = [
  { key: 'overview', label: 'Overview', icon: Waypoints },
  { key: 'timeline', label: 'Timeline', icon: ListTree },
  { key: 'list', label: 'Credentials', icon: LayoutGrid },
];

/**
 * "Academic Credential Graph" — a small, data-driven node/edge visualization
 * of the student's own credentials (see lib/credentialGraph.js). No fake
 * relationships, categories, or institutions are introduced; the shape of
 * the graph adapts to whatever the student actually has.
 */
export default function CredentialGraph({ profile, credentials }) {
  const graph = useMemo(() => buildCredentialGraph(profile, credentials), [profile, credentials]);
  const [view, setView] = useState('overview');
  const [selectedId, setSelectedId] = useState(null);
  const [hoveredId, setHoveredId] = useState(null);
  const [proofCredential, setProofCredential] = useState(null);
  const [lines, setLines] = useState([]);

  const containerRef = useRef(null);
  const nodeRefs = useRef(new Map());

  const chronological = useMemo(() => orderChronologically(graph.credentials), [graph.credentials]);

  // Which edges to draw depends on the active view: Overview uses the real
  // identity/institution/credential tree; Timeline re-links the same nodes
  // as a single chronological chain instead.
  const activeRelationships = useMemo(() => {
    if (view === 'list') return [];
    if (view === 'timeline') {
      const edges = [];
      let prev = 'identity';
      for (const node of chronological) {
        edges.push({ from: prev, to: node.id });
        prev = node.id;
      }
      return edges;
    }
    return graph.relationships;
  }, [view, chronological, graph.relationships]);

  const setNodeRef = useCallback(
    (id) => (el) => {
      if (el) nodeRefs.current.set(id, el);
      else nodeRefs.current.delete(id);
    },
    []
  );

  const recomputeLines = useCallback(() => {
    const container = containerRef.current;
    if (!container || activeRelationships.length === 0) {
      setLines([]);
      return;
    }
    const containerRect = container.getBoundingClientRect();
    const anchorPoint = (el, edge) => {
      const r = el.getBoundingClientRect();
      return {
        x: r.left + r.width / 2 - containerRect.left,
        y: (edge === 'bottom' ? r.bottom : r.top) - containerRect.top,
      };
    };

    const next = [];
    for (const rel of activeRelationships) {
      const fromEl = nodeRefs.current.get(rel.from);
      const toEl = nodeRefs.current.get(rel.to);
      if (!fromEl || !toEl) continue;
      next.push({
        key: `${rel.from}->${rel.to}`,
        toId: rel.to,
        from: anchorPoint(fromEl, 'bottom'),
        to: anchorPoint(toEl, 'top'),
      });
    }
    setLines(next);
  }, [activeRelationships]);

  useLayoutEffect(() => {
    recomputeLines();
  }, [recomputeLines]);

  useEffect(() => {
    const handle = () => recomputeLines();
    window.addEventListener('resize', handle);
    let ro;
    if (containerRef.current && typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(handle);
      ro.observe(containerRef.current);
    }
    return () => {
      window.removeEventListener('resize', handle);
      ro?.disconnect();
    };
  }, [recomputeLines]);

  const selected = graph.credentials.find((c) => c.id === selectedId) || null;

  const handleReset = () => {
    setSelectedId(null);
    setHoveredId(null);
    setView('overview');
  };

  const handleViewCredential = (credentialId) => {
    const el = document.getElementById(`credential-${credentialId}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const nodesForCurrentView = view === 'timeline' ? chronological : graph.credentials;

  return (
    <div className="bg-card border border-border rounded-lg card-shadow p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div className="flex gap-1 bg-bg border border-border rounded-lg p-1">
          {VIEW_MODES.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => {
                setView(key);
                setSelectedId(null);
              }}
              aria-pressed={view === key}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                view === key ? 'bg-white text-teal card-shadow' : 'text-ink-soft hover:text-ink'
              }`}
            >
              <Icon size={13} aria-hidden="true" />
              {label}
            </button>
          ))}
        </div>
        <button
          onClick={handleReset}
          className="flex items-center gap-1.5 text-xs font-medium text-ink-soft hover:text-ink border border-border rounded-md px-3 py-1.5"
        >
          <RotateCcw size={12} aria-hidden="true" />
          Reset view
        </button>
      </div>

      {view === 'list' ? (
        <CredentialListView
          nodes={graph.credentials}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
      ) : (
        <div ref={containerRef} className="relative">
          <svg
            className="absolute inset-0 w-full h-full pointer-events-none transition-opacity duration-300"
            style={{ opacity: lines.length ? 1 : 0 }}
            aria-hidden="true"
          >
            {lines.map((line) => {
              const active = line.toId === hoveredId || line.toId === selectedId;
              return (
                <line
                  key={line.key}
                  x1={line.from.x}
                  y1={line.from.y}
                  x2={line.to.x}
                  y2={line.to.y}
                  stroke={active ? '#2E5568' : '#D7DFE0'}
                  strokeWidth={active ? 2 : 1.5}
                />
              );
            })}
          </svg>

          <div className="relative flex flex-col items-center gap-8">
            <IdentityNode identity={graph.identity} refCallback={setNodeRef('identity')} />

            {view === 'overview' && graph.institutions.length > 0 && (
              <div className="flex flex-wrap justify-center gap-4">
                {graph.institutions.map((inst) => (
                  <InstitutionNode key={inst.id} institution={inst} refCallback={setNodeRef(inst.id)} />
                ))}
              </div>
            )}

            <div
              className={`flex gap-4 ${
                view === 'timeline'
                  ? 'flex-col items-center'
                  : 'flex-row flex-wrap justify-center'
              }`}
            >
              {nodesForCurrentView.map((node, i) => (
                <GraphNode
                  key={node.id}
                  node={node}
                  refCallback={setNodeRef(node.id)}
                  selected={selectedId === node.id}
                  style={{ animationDelay: `${120 + i * 50}ms` }}
                  onClick={() =>
                    setSelectedId((current) => (current === node.id ? null : node.id))
                  }
                  onHoverStart={() => setHoveredId(node.id)}
                  onHoverEnd={() => setHoveredId((h) => (h === node.id ? null : h))}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      <GraphLegend showInstitution={graph.institutions.length > 0} />

      {/* Screen-reader-friendly equivalent of the visual graph, present
          whenever the plain list view isn't already showing this info. */}
      {view !== 'list' && (
        <ul className="sr-only">
          {graph.credentials.map((c) => (
            <li key={c.id}>
              {c.type}, {c.institution}, issued {c.issueYear}, {c.status === 'valid' ? 'verified' : 'revoked'}.
            </li>
          ))}
        </ul>
      )}

      {selected && (
        <NodeDetailPanel
          credential={selected}
          onClose={() => setSelectedId(null)}
          onViewCredential={() => handleViewCredential(selected.credentialId)}
          onViewProof={() => setProofCredential(selected)}
        />
      )}

      {proofCredential && (
        <VerificationProofModal
          // The graph node only carries display fields — VerificationProofModal
          // needs the full raw credential record to recompute its certificate
          // hash, so it's looked up by ID rather than passed the node itself.
          credential={credentials.find((c) => c.credentialId === proofCredential.credentialId)}
          onClose={() => setProofCredential(null)}
        />
      )}
    </div>
  );
}

// ---- Nodes -------------------------------------------------------------

function IdentityNode({ identity, refCallback }) {
  return (
    <div
      ref={refCallback}
      className="graph-node-in bg-teal text-white rounded-lg card-shadow px-5 py-3.5 text-center max-w-[220px]"
    >
      <GraduationCap size={18} className="mx-auto mb-1.5" aria-hidden="true" />
      <p className="text-[10px] font-medium tracking-wide uppercase text-white/70">
        Verified Academic Identity
      </p>
      <p className="text-sm font-semibold truncate">{identity.studentName}</p>
      <p className="text-[11px] flex items-center justify-center gap-1 mt-1 text-white/85">
        <Check size={11} aria-hidden="true" />
        {identity.allVerified ? 'Verified' : 'Needs attention'}
      </p>
    </div>
  );
}

function InstitutionNode({ institution, refCallback }) {
  return (
    <div
      ref={refCallback}
      className="graph-node-in flex items-center gap-1.5 bg-sand-soft text-sand text-xs font-medium rounded-full px-3 py-1.5"
    >
      <Building2 size={12} aria-hidden="true" />
      {institution.name}
    </div>
  );
}

function GraphNode({ node, refCallback, selected, style, onClick, onHoverStart, onHoverEnd }) {
  const revoked = node.status === 'revoked';
  const label = `${node.type}, ${node.institution}, issued ${node.issueYear}, ${
    revoked ? 'revoked' : 'verified'
  }. Press for details.`;

  return (
    <button
      ref={refCallback}
      type="button"
      onClick={onClick}
      onMouseEnter={onHoverStart}
      onMouseLeave={onHoverEnd}
      onFocus={onHoverStart}
      onBlur={onHoverEnd}
      aria-expanded={selected}
      aria-label={label}
      style={style}
      className={`graph-node-in text-left w-[168px] rounded-lg border card-shadow p-3 transition-all duration-150 ${
        selected ? '-translate-y-0.5 shadow-md' : 'hover:-translate-y-0.5'
      } ${revoked ? 'bg-revoked-soft/60 border-revoked/30' : 'bg-white border-border'} ${
        selected ? (revoked ? 'ring-2 ring-revoked/40' : 'ring-2 ring-teal/40') : ''
      }`}
    >
      <div className="flex items-center gap-1.5 mb-1">
        {revoked ? (
          <ShieldAlert size={13} className="text-revoked shrink-0" aria-hidden="true" />
        ) : (
          <GraduationCap size={13} className="text-teal shrink-0" aria-hidden="true" />
        )}
        <p className="text-xs font-semibold leading-snug truncate">{node.type}</p>
      </div>
      <p className="text-[11px] text-ink-soft truncate">{node.institution}</p>
      <div className="flex items-center justify-between mt-1.5">
        <span className="text-[11px] text-ink-soft">{node.issueYear}</span>
        <span
          className={`flex items-center gap-1 text-[11px] font-medium ${
            revoked ? 'text-revoked' : 'text-valid'
          }`}
        >
          <span
            className={`w-1.5 h-1.5 rounded-full ${revoked ? 'bg-revoked' : 'bg-valid'}`}
            aria-hidden="true"
          />
          {revoked ? 'Revoked' : 'Verified'}
        </span>
      </div>
    </button>
  );
}

// ---- List view (also doubles as a plain, fully accessible view) --------

function CredentialListView({ nodes, selectedId, onSelect }) {
  return (
    <ul className="grid sm:grid-cols-2 gap-3">
      {nodes.map((node) => {
        const revoked = node.status === 'revoked';
        return (
          <li key={node.id}>
            <button
              type="button"
              onClick={() => onSelect(selectedId === node.id ? null : node.id)}
              aria-expanded={selectedId === node.id}
              className={`w-full text-left rounded-lg border p-3 transition-colors ${
                selectedId === node.id ? 'border-teal ring-2 ring-teal/30' : 'border-border hover:bg-bg/60'
              } ${revoked ? 'bg-revoked-soft/40' : 'bg-white'}`}
            >
              <p className="text-xs font-semibold truncate">{node.type}</p>
              <p className="text-[11px] text-ink-soft truncate">
                {node.institution} · {node.issueYear}
              </p>
              <span
                className={`inline-flex items-center gap-1 text-[11px] font-medium mt-1 ${
                  revoked ? 'text-revoked' : 'text-valid'
                }`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${revoked ? 'bg-revoked' : 'bg-valid'}`}
                  aria-hidden="true"
                />
                {revoked ? 'Revoked' : 'Verified'}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

// ---- Legend --------------------------------------------------------------

function GraphLegend({ showInstitution }) {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 mt-6 pt-4 border-t border-border text-[11px] text-ink-soft">
      <span className="flex items-center gap-1.5">
        <span className="w-2 h-2 rounded-full bg-valid" aria-hidden="true" />
        <Check size={11} aria-hidden="true" />
        Active / Verified
      </span>
      <span className="flex items-center gap-1.5">
        <span className="w-2 h-2 rounded-full bg-revoked" aria-hidden="true" />
        <ShieldAlert size={11} aria-hidden="true" />
        Revoked
      </span>
      {showInstitution && (
        <span className="flex items-center gap-1.5">
          <Building2 size={11} aria-hidden="true" />
          Institution
        </span>
      )}
    </div>
  );
}

// ---- Detail panel ----------------------------------------------------------

function NodeDetailPanel({ credential, onClose, onViewCredential, onViewProof }) {
  const revoked = credential.status === 'revoked';
  return (
    <div className="mt-5 border border-border rounded-lg p-4 sm:p-5 bg-bg/50">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold truncate">{credential.type}</p>
          <p className="text-xs text-ink-soft flex items-center gap-1 mt-0.5">
            <Building2 size={11} aria-hidden="true" />
            {credential.institution}
          </p>
        </div>
        <button onClick={onClose} className="text-ink-soft hover:text-ink shrink-0" aria-label="Close details">
          <X size={16} />
        </button>
      </div>

      <div className="grid sm:grid-cols-2 gap-x-4 gap-y-1.5 text-xs text-ink-soft mb-4">
        <p className="flex items-center gap-1.5">
          <CalendarDays size={11} aria-hidden="true" />
          Issued {credential.issueDate}
        </p>
        <p className="flex items-center gap-1.5 font-mono">
          <Hash size={11} aria-hidden="true" />
          {credential.credentialId}
        </p>
        <p className={`flex items-center gap-1.5 font-medium ${revoked ? 'text-revoked' : 'text-valid'}`}>
          {revoked ? <ShieldAlert size={11} aria-hidden="true" /> : <Check size={11} aria-hidden="true" />}
          {revoked ? 'Revoked' : 'Active'}
        </p>
      </div>

      <CredentialDNA hash={credential.hash} compact />

      <div className="flex gap-2 mt-4">
        <button
          onClick={onViewCredential}
          className="flex-1 flex items-center justify-center gap-1.5 text-xs font-medium border border-border rounded-md px-3 py-2 hover:bg-bg"
        >
          <ArrowUpRight size={13} aria-hidden="true" />
          View credential
        </button>
        <button
          onClick={onViewProof}
          className="flex-1 flex items-center justify-center gap-1.5 text-xs font-medium bg-teal text-white rounded-md px-3 py-2 hover:bg-teal/90"
        >
          <Eye size={13} aria-hidden="true" />
          View verification proof
        </button>
      </div>
    </div>
  );
}
