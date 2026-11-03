// Connects the blockchain in ../blockchain to the rest of the API:
//   - persists every node's copy of the chain (memory or PostgreSQL)
//   - serialises writers, so two requests cannot both build block n
//   - exposes the same "bridge" methods the API used for the Solidity contract,
//     so routes do not care which ledger is behind them
//   - read-only explorer and tamper-simulation views

import crypto from 'node:crypto';
import { keccak256, toUtf8Bytes } from 'ethers';
import {
  BlockchainNetwork,
  ChainRuleError,
  MAX_TX_PER_BLOCK,
  QuorumError,
  addressOf,
  checkVotes,
  createTransaction,
  hashHeader,
  merkleProof,
  merkleRoot,
  meetsDifficulty,
  mine,
  replayChain,
  transactionId,
  verifyMerkleProof,
  checkTransaction,
} from '../blockchain/index.js';
import { ChainUnavailableError, ContractRevertError } from './chain.js';

const LOCK_ID = 727001;

export function createMemoryLedgerStore() {
  const rows = new Map(); // nodeId -> blocks[]
  return {
    async heights() {
      return Object.fromEntries([...rows].map(([id, blocks]) => [id, blocks.length]));
    },
    async load(nodeId, fromIndex = 0) {
      return structuredClone((rows.get(nodeId) ?? []).slice(fromIndex));
    },
    async withLock(fn) {
      return fn(this);
    },
    async append(block, nodeIds) {
      for (const id of nodeIds) {
        if (!rows.has(id)) rows.set(id, []);
        rows.get(id).push(structuredClone(block));
      }
    },
    async replace(nodeId, blocks) {
      rows.set(nodeId, structuredClone(blocks));
    },
    // test hook: edits one node's stored copy behind the chain's back
    corrupt(nodeId, index, mutate) {
      mutate(rows.get(nodeId)[index]);
    },
  };
}

/** @param {{ raw: Function, connect: Function }} store the PostgreSQL store */
export function createPgLedgerStore(store) {
  const inserter = (query) => ({
    async appendAll(nodeId, blocks) {
      for (const block of blocks) await this.append(block, [nodeId]);
    },
    async append(block, nodeIds) {
      for (const id of nodeIds) {
        await query(
          'INSERT INTO chain_blocks (node_id, idx, hash, previous_hash, block) VALUES ($1, $2, $3, $4, $5)',
          [id, block.header.index, block.hash, block.header.previousHash, block]
        );
      }
    },
  });
  return {
    async heights() {
      const { rows } = await store.raw('SELECT node_id, max(idx) + 1 AS n FROM chain_blocks GROUP BY node_id');
      return Object.fromEntries(rows.map((r) => [r.node_id, Number(r.n)]));
    },
    async load(nodeId, fromIndex = 0) {
      const { rows } = await store.raw('SELECT block FROM chain_blocks WHERE node_id = $1 AND idx >= $2 ORDER BY idx', [
        nodeId,
        fromIndex,
      ]);
      return rows.map((r) => r.block);
    },
    async replace(nodeId, blocks) {
      await store.raw('DELETE FROM chain_blocks WHERE node_id = $1', [nodeId]);
      await inserter((sql, params) => store.raw(sql, params)).appendAll(nodeId, blocks);
    },
    // One writer at a time across all server instances; released on commit.
    async withLock(fn) {
      const client = await store.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock($1)', [LOCK_ID]);
        const out = await fn(inserter((sql, params) => client.query(sql, params)));
        await client.query('COMMIT');
        return out;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
  };
}

/** Node keys are derived from the server secret, so each stays stable across restarts. */
export const deriveValidatorKeys = (secret, count = 3) =>
  Array.from({ length: count }, (_, i) =>
    `0x${crypto.createHash('sha256').update(secret).update(`validator-node-${i + 1}`).digest('hex')}`
  );

const iso = (ms) => (ms ? new Date(ms).toISOString() : null);
const with0x = (hex) => (hex ? `0x${hex}` : null);
const toRuleError = (err) => {
  if (err instanceof ChainRuleError) return new ContractRevertError(err.reason);
  if (err instanceof ContractRevertError || err instanceof ChainUnavailableError) return err;
  return new ChainUnavailableError(err);
};

export function createLedger({ ledgerStore, authorityKey, validatorKeys, chainName, rootIssuerName, difficulty = 3, onCommit }) {
  const network = new BlockchainNetwork(validatorKeys);
  let loaded = null;

  async function initialise() {
    for (const node of network.nodes) {
      node.load(await ledgerStore.load(node.id), { deep: false });
    }
    if (network.nodes.every((n) => n.blocks.length === 0)) {
      await write([
        network.genesisTransaction({ authorityKey, authorityName: rootIssuerName, chainName, difficulty }),
      ]);
    }
  }

  const ready = () => {
    loaded ??= initialise().catch((err) => {
      loaded = null;
      throw err;
    });
    return loaded;
  };

  /** Picks up blocks written by another server instance. */
  async function refresh(store = ledgerStore) {
    const heights = await store.heights();
    for (const node of network.nodes) {
      const stored = heights[node.id] ?? 0;
      if (stored > node.blocks.length) node.load([...node.blocks, ...(await ledgerStore.load(node.id, node.blocks.length))], { deep: false });
    }
  }

  /** One block: consensus, then durable storage, then in-memory commit. */
  async function write(transactions) {
    const proposal = await ledgerStore.withLock(async (txStore) => {
      await refresh();
      const agreed = network.propose(transactions);
      await txStore.append(agreed.block, agreed.voters.map((n) => n.id));
      return agreed;
    });
    // Only after the database committed, so memory can never get ahead of it.
    network.commit(proposal);
    await onCommit?.(proposal.block);
    return proposal.block;
  }

  const guarded = async (fn) => {
    try {
      await ready();
      await refresh();
      return await fn();
    } catch (err) {
      if (err instanceof QuorumError) throw new ChainUnavailableError(err);
      throw toRuleError(err);
    }
  };

  const receiptOf = (tx, block) => ({
    txHash: with0x(tx.id),
    blockNumber: block.header.index,
    blockHash: block.hash,
    gasUsed: 0n, // this chain has no gas
    logs: [],
  });

  async function submitChunks(makeTxs) {
    const receipts = [];
    for (let i = 0; i < makeTxs.length; i += MAX_TX_PER_BLOCK) {
      const txs = makeTxs.slice(i, i + MAX_TX_PER_BLOCK).map((make) => make());
      const block = await write(txs);
      receipts.push(...txs.map((tx) => receiptOf(tx, block)));
    }
    return receipts;
  }

  /**
   * Asks every node separately. A certificate is only believed when a majority
   * of nodes give the same hash and status from their own copies of the chain.
   */
  function crossCheck(find) {
    const answers = network.nodes.map((node) => {
      const cert = find(node.state);
      return {
        node: node.id,
        found: Boolean(cert),
        certHash: cert?.certHash ?? null,
        status: cert?.status ?? null,
        block: cert?.events[0].block ?? null,
        healthy: node.integrity.valid,
      };
    });
    // A node whose copy failed validation gets no vote.
    const groups = new Map();
    for (const a of answers.filter((x) => x.healthy)) {
      const k = `${a.certHash}|${a.status}`;
      groups.set(k, [...(groups.get(k) ?? []), a]);
    }
    const [largest = []] = [...groups.values()].sort((x, y) => y.length - x.length);
    if (largest.length < network.quorum) throw new ChainUnavailableError(new Error('Nodes disagree: no majority answer.'));
    const agreed = network.nodes.find((n) => n.id === largest[0].node);
    return { cert: find(agreed.state), answers, agree: largest.length, total: answers.length, quorum: network.quorum };
  }

  const crossCheckedView = (find) => {
    const { cert, ...consensus } = crossCheck(find);
    return cert ? { ...onChainView(cert), consensus } : null;
  };

  const onChainView = (cert) =>
    cert && {
      credentialId: cert.credentialId,
      marksHash: cert.marksHash,
      certNo: cert.certNo,
      hash: with0x(cert.fileHash ?? cert.certHash),
      certHash: cert.certHash,
      issuer: cert.issuer,
      issuerActive: Boolean(network.state.issuers.get(cert.issuer.toLowerCase())?.active),
      issuedAt: iso(cert.issuedAt),
      revokedAt: iso(cert.revokedAt),
      status: cert.status,
      block: cert.events[0].block,
      txId: cert.events[0].txId,
    };

  /** The bridge API signs with one key: the authority's, or a university's. */
  function bridge(privateKey) {
    const tx = (type, payload) => createTransaction(type, payload, privateKey);
    return {
      address: () => guarded(async () => network.leader.blocks[0].hash),
      owner: () => guarded(async () => network.state.config.authority),
      paused: () => guarded(async () => network.state.paused),
      setPaused: (paused) =>
        guarded(async () => {
          const t = tx('SET_PAUSED', { paused: Boolean(paused) });
          return receiptOf(t, await write([t]));
        }),
      setIssuer: (address, name, active) =>
        guarded(async () => {
          const t = tx('SET_ISSUER', { address, name, active: Boolean(active) });
          return receiptOf(t, await write([t]));
        }),
      fund: async () => ({ txHash: null, skipped: true }), // no gas, nothing to fund
      issue: (credentialId, hash, extra = {}) =>
        guarded(async () => {
          const t = tx('ISSUE', {
            credentialId,
            certNo: extra.certNo ?? null,
            certHash: extra.certHash ?? hash,
            fileHash: extra.certHash ? hash : null,
            marksHash: extra.marksHash ?? null,
          });
          return receiptOf(t, await write([t]));
        }),
      issueMany: (items) =>
        guarded(() =>
          submitChunks(
            items.map((item) => () =>
              tx('ISSUE', {
                credentialId: item.credentialId,
                certNo: item.certNo ?? null,
                certHash: item.certHash ?? item.hash,
                fileHash: item.certHash ? item.hash : null,
                marksHash: item.marksHash ?? null,
              })
            )
          )
        ),
      revoke: (credentialId, reason) =>
        guarded(async () => {
          const t = tx('REVOKE', { credentialId, reasonHash: keccak256(toUtf8Bytes(reason)) });
          return receiptOf(t, await write([t]));
        }),
      revokeMany: (items) =>
        guarded(() =>
          submitChunks(
            items.map(({ credentialId, reason }) => () =>
              tx('REVOKE', { credentialId, reasonHash: keccak256(toUtf8Bytes(reason)) })
            )
          )
        ),
      getById: (id) => guarded(async () => crossCheckedView((state) => state.lookup(id))),
      getByHash: (hash) => guarded(async () => crossCheckedView((state) => state.lookupHash(hash))),
      history: (credentialId) =>
        guarded(async () =>
          (network.state.lookup(credentialId)?.events ?? []).map((e) => ({
            type: e.type,
            txHash: with0x(e.txId),
            blockNumber: e.block,
            at: iso(e.at),
            issuer: e.issuer,
            ...(e.type === 'revoked' ? { reasonHash: e.reasonHash } : { docHash: with0x(e.hash) }),
          }))
        ),
    };
  }

  /** Locates a transaction and proves it belongs to its block and the chain. */
  function inclusionProof(txId) {
    const blocks = network.leader.blocks;
    const block = blocks.find((b) => b.transactions.some((t) => t.id === txId));
    if (!block) return null;
    const ids = block.transactions.map((t) => t.id);
    const proof = merkleProof(ids, ids.indexOf(txId));
    return {
      txId,
      block: block.header.index,
      blockHash: block.hash,
      previousHash: block.header.previousHash,
      merkleRoot: block.header.merkleRoot,
      merkleProof: proof,
      merkleProofValid: verifyMerkleProof(txId, proof, block.header.merkleRoot),
      headerHashValid: hashHeader(block.header) === block.hash,
      validatorSignatures: block.signatures.length,
      confirmations: blocks.length - 1 - block.header.index,
      chainWalk: walkFrom(block.header.index, txId),
    };
  }

  /**
   * Walks from a block to the newest block: every header must hash to its stored
   * hash and every block must point to the one before it. Also checks the
   * validators' signatures on the certificate's own block and its issuer's signature.
   */
  function walkFrom(index, txId) {
    const blocks = network.leader.blocks;
    const start = blocks[index];
    const tx = start.transactions.find((t) => t.id === txId);
    const walk = {
      from: index,
      to: blocks.length - 1,
      blocksChecked: blocks.length - index,
      valid: true,
      brokenAt: null,
      issuerSignatureValid: !checkTransaction(tx),
      validatorSignaturesValid: !checkVotes(start, network.state.config.validators),
    };
    for (let i = index; i < blocks.length; i++) {
      const linkOk = i === index || blocks[i].header.previousHash === blocks[i - 1].hash;
      if (!linkOk || hashHeader(blocks[i].header) !== blocks[i].hash) {
        walk.valid = false;
        walk.brokenAt = i;
        break;
      }
    }
    walk.valid = walk.valid && walk.issuerSignatureValid && walk.validatorSignaturesValid;
    return walk;
  }

  const blockSummary = (b) => ({
    index: b.header.index,
    hash: b.hash,
    previousHash: b.header.previousHash,
    merkleRoot: b.header.merkleRoot,
    timestamp: iso(b.header.timestamp),
    nonce: b.header.nonce,
    difficulty: b.header.difficulty,
    proposer: b.header.proposer,
    txCount: b.transactions.length,
    signatures: b.signatures.length,
    types: [...new Set(b.transactions.map((t) => t.type))],
  });

  const explorer = {
    summary: () =>
      guarded(async () => {
        const { state, leader } = network;
        const consensus = network.consensus();
        return {
          chainName: state.config.chainName,
          blocks: leader.blocks.length,
          height: leader.height,
          transactions: state.txCount,
          certificates: state.certificates.size,
          revoked: [...state.certificates.values()].filter((c) => c.status === 'revoked').length,
          issuers: [...state.issuers.values()].map(({ address, name, active }) => ({ address, name, active })),
          authority: state.config.authority,
          difficulty: state.config.difficulty,
          quorum: network.quorum,
          maxTxPerBlock: MAX_TX_PER_BLOCK,
          genesisHash: leader.blocks[0].hash,
          headHash: leader.head.hash,
          nodes: network.nodes.map((n) => ({
            id: n.id,
            address: n.address,
            online: n.online,
            height: n.height,
            head: n.head?.hash ?? null,
            valid: n.integrity.valid,
            problem: n.integrity.problem,
          })),
          consensus,
        };
      }),
    blocks: ({ from, limit = 20 }) =>
      guarded(async () => {
        const blocks = network.leader.blocks;
        const end = from == null ? blocks.length : Math.min(Number(from) + 1, blocks.length);
        const start = Math.max(0, end - Math.min(limit, 100));
        return { total: blocks.length, blocks: blocks.slice(start, end).map(blockSummary).reverse() };
      }),
    block: (index) =>
      guarded(async () => {
        const blocks = network.leader.blocks;
        const b = blocks[index];
        if (!b) return null;
        return {
          ...blockSummary(b),
          nextHash: blocks[index + 1]?.hash ?? null,
          headerHashValid: hashHeader(b.header) === b.hash,
          merkleRootValid: merkleRoot(b.transactions.map((t) => t.id)) === b.header.merkleRoot,
          linkValid: index === 0 ? true : blocks[index - 1].hash === b.header.previousHash,
          powValid: meetsDifficulty(b.hash, b.header.difficulty),
          transactions: b.transactions.map(({ id, type, from: sender, payload, timestamp, signature }) => ({
            id,
            type,
            from: sender,
            payload,
            timestamp: iso(timestamp),
            signature,
          })),
        };
      }),
    audit: ({ deep }) => guarded(async () => network.audit({ deep })),
    simulateTamper: (index) => guarded(async () => simulateTamper(network, index)),
    inclusionProof: (txId) => guarded(async () => inclusionProof(txId)),
  };

  /** Overwrites any corrupted or lagging node's stored copy from the healthy majority. */
  async function repair() {
    await ready();
    await refresh();
    const healthy = network.healthyNodes;
    if (healthy.length < network.quorum) throw new Error('No healthy majority to repair from.');
    const repaired = network.repair();
    for (const id of repaired) await ledgerStore.replace(id, network.leader.blocks);
    return repaired;
  }

  return { bridge, explorer, network, ready, repair, authority: addressOf(authorityKey) };
}

/**
 * Shows, on a throwaway copy, what happens as an attacker tries harder and
 * harder to alter a certificate hash in one block. Every problem listed is
 * found by the real validation code. Nothing is saved.
 */
export function simulateTamper(network, index) {
  const original = network.leader.blocks;
  const target = original.findIndex((b, i) => i >= index && b.transactions.some((t) => t.type === 'ISSUE'));
  if (target < 0) return null;
  const copy = structuredClone(original);
  const validators = network.state.config.validators;
  const block = copy[target];
  const tx = block.transactions.find((t) => t.type === 'ISSUE');
  const originalHash = tx.payload.certHash;
  const forgedHash = 'f'.repeat(64);

  const report = (attempt) => {
    const problems = [];
    const txProblem = checkTransaction(tx);
    if (txProblem) problems.push(`Block ${target}: ${txProblem}`);
    const replay = replayChain(copy, { deep: false });
    if (!replay.valid) problems.push(`Block ${replay.invalidAt}: ${replay.problem}`);
    if (block.hash !== original[target].hash && checkVotes(block, validators)) {
      problems.push(`Block ${target}: validators never signed this hash (not_enough_validator_signatures)`);
    }
    return { attempt, detected: problems.length > 0, problems };
  };

  const steps = [];
  tx.payload.certHash = forgedHash;
  steps.push(report('Edit the certificate hash stored in the block'));

  tx.id = transactionId(tx);
  block.header.merkleRoot = merkleRoot(block.transactions.map((t) => t.id));
  steps.push(report('Also recompute the transaction id and the Merkle root'));

  const mined = mine({ ...block.header });
  block.header = mined.header;
  block.hash = mined.hash;
  steps.push(report('Also re-mine this block (new nonce, new block hash)'));

  for (let i = target + 1; i < copy.length; i++) {
    copy[i].header.previousHash = copy[i - 1].hash;
    const m = mine({ ...copy[i].header });
    copy[i].header = m.header;
    copy[i].hash = m.hash;
  }
  steps.push(report(`Also re-mine all ${copy.length - 1 - target} later blocks`));

  return {
    block: target,
    transactionId: original[target].transactions.find((t) => t.type === 'ISSUE').id,
    originalHash,
    forgedHash,
    totalBlocks: original.length,
    steps,
  };
}

// Used by tests and scripts.
export { quorumOf } from '../blockchain/index.js';
