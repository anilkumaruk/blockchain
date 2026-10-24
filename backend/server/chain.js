// Blockchain bridge: the only module that talks to the CredentialRegistry
// contract. Everything above it deals in plain JS objects and two error
// types, so routes never have to understand ethers.js errors.

import { keccak256, toUtf8Bytes } from 'ethers';

const STATUS = ['none', 'valid', 'revoked'];

export class ChainUnavailableError extends Error {
  constructor(cause) {
    super('Blockchain network is unavailable.');
    this.name = 'ChainUnavailableError';
    this.cause = cause;
  }
}

export class ContractRevertError extends Error {
  constructor(reason) {
    super(`Contract rejected the transaction: ${reason}`);
    this.name = 'ContractRevertError';
    this.reason = reason;
  }
}

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`RPC timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function toHex32(hash) {
  const hex = String(hash).toLowerCase().replace(/^0x/, '');
  if (!/^[0-9a-f]{64}$/.test(hex)) throw new TypeError('Expected a 32-byte hex SHA-256 digest');
  return '0x' + hex;
}

function decodeCredential([credential, issuerActive]) {
  const status = STATUS[Number(credential.status)];
  if (status === 'none') return null;
  return {
    hash: credential.docHash.toLowerCase(),
    issuer: credential.issuer,
    issuerActive,
    issuedAt: new Date(Number(credential.issuedAt) * 1000).toISOString(),
    revokedAt: Number(credential.revokedAt)
      ? new Date(Number(credential.revokedAt) * 1000).toISOString()
      : null,
    status,
  };
}

/**
 * @param {import('ethers').Contract} contract  CredentialRegistry connected to the issuer's signer
 * @param {{ timeoutMs?: number, writeTimeoutMs?: number, fromBlock?: number }} [options]
 *        timeoutMs: reads. writeTimeoutMs: transactions, which wait for a block
 *        (~12 s on Sepolia) - a too-short limit would report a mined tx as failed.
 *        fromBlock: deployment block, so event history queries don't scan the whole chain
 */
export function createChainBridge(contract, { timeoutMs = 8000, writeTimeoutMs = 180_000, fromBlock = 0 } = {}) {
  const call = async (fn, ms = timeoutMs) => {
    try {
      return await withTimeout(fn(), ms);
    } catch (err) {
      const reason = err?.revert?.name ?? tryParseRevert(contract, err);
      if (reason) throw new ContractRevertError(reason);
      throw new ChainUnavailableError(err);
    }
  };

  const write = (fn) => call(fn, writeTimeoutMs);

  const receiptOf = async (tx) => {
    const receipt = await tx.wait();
    return { txHash: receipt.hash, blockNumber: receipt.blockNumber, gasUsed: receipt.gasUsed, logs: receipt.logs };
  };

  async function eventsToHistory(events, type) {
    return Promise.all(
      events.map(async (e) => {
        const block = await e.getBlock();
        return {
          type,
          txHash: e.transactionHash,
          blockNumber: e.blockNumber,
          at: new Date(block.timestamp * 1000).toISOString(),
          issuer: e.args.issuer,
          ...(type === 'revoked' ? { reasonHash: e.args.reasonHash } : {}),
          ...(type === 'batch_anchored' ? { batchId: Number(e.args.batchId), root: e.args.root } : {}),
          ...(type === 'issued' ? { docHash: e.args.docHash } : {}),
        };
      })
    );
  }

  return {
    async address() {
      return call(() => contract.getAddress());
    },

    async owner() {
      return call(() => contract.owner());
    },

    async issue(credentialId, hash) {
      return write(async () => receiptOf(await contract.issueCredential(credentialId, toHex32(hash))));
    },

    async revoke(credentialId, reason) {
      return write(async () =>
        receiptOf(await contract.revokeCredential(credentialId, keccak256(toUtf8Bytes(reason))))
      );
    },

    async setIssuer(address, name, active) {
      return write(async () => receiptOf(await contract.setIssuer(address, name, active)));
    },

    /** Sends ETH for gas, topping up only when the balance is below the target. */
    async fund(address, wei) {
      return write(async () => {
        const runner = contract.runner;
        const balance = await runner.provider.getBalance(address);
        if (balance >= wei / 2n) return { txHash: null, skipped: true };
        return receiptOf(await runner.sendTransaction({ to: address, value: wei - balance }));
      });
    },

    async paused() {
      return call(() => contract.paused());
    },

    async setPaused(paused) {
      return write(async () => receiptOf(await (paused ? contract.pause() : contract.unpause())));
    },

    async anchorBatch(root, count) {
      return write(async () => {
        const receipt = await receiptOf(await contract.anchorBatch(root, count));
        const event = receipt.logs
          .map((log) => {
            try {
              return contract.interface.parseLog(log);
            } catch {
              return null;
            }
          })
          .find((e) => e?.name === 'BatchAnchored');
        return { ...receipt, batchId: Number(event.args.batchId) };
      });
    },

    async revokeBatch({ batchId, credentialId, hash, proof }, reason) {
      return write(async () =>
        receiptOf(
          await contract.revokeBatchCredential(
            batchId,
            credentialId,
            toHex32(hash),
            proof,
            keccak256(toUtf8Bytes(reason))
          )
        )
      );
    },

    async verifyBatch({ batchId, credentialId, hash, proof }) {
      const r = await call(() => contract.verifyBatchCredential(batchId, credentialId, toHex32(hash), proof));
      if (!r.included) return null;
      return {
        hash: toHex32(hash),
        issuer: r.issuer,
        issuerActive: r.issuerActive,
        issuedAt: new Date(Number(r.anchoredAt) * 1000).toISOString(),
        revokedAt: Number(r.revokedAt) ? new Date(Number(r.revokedAt) * 1000).toISOString() : null,
        status: Number(r.revokedAt) ? 'revoked' : 'valid',
        batchId,
      };
    },

    /** Full on-chain audit trail for one credential, oldest first. */
    async history(credentialId, batchId) {
      return call(async () => {
        const key = keccak256(toUtf8Bytes(credentialId));
        const [issued, revoked, anchored] = await Promise.all([
          contract.queryFilter(contract.filters.CredentialIssued(key), fromBlock),
          contract.queryFilter(contract.filters.CredentialRevoked(key), fromBlock),
          batchId ? contract.queryFilter(contract.filters.BatchAnchored(batchId), fromBlock) : [],
        ]);
        const all = [
          ...(await eventsToHistory(issued, 'issued')),
          ...(await eventsToHistory(anchored, 'batch_anchored')),
          ...(await eventsToHistory(revoked, 'revoked')),
        ];
        return all.sort((a, b) => a.blockNumber - b.blockNumber);
      });
    },

    async getById(credentialId) {
      return decodeCredential(await call(() => contract.getCredential(credentialId)));
    },

    async getByHash(hash) {
      return decodeCredential(await call(() => contract.getCredentialByHash(toHex32(hash))));
    },
  };
}

function tryParseRevert(contract, err) {
  const data = err?.data ?? err?.error?.data ?? err?.info?.error?.data;
  if (typeof data !== 'string' || data.length < 10) return null;
  try {
    return contract.interface.parseError(data)?.name ?? null;
  } catch {
    return null;
  }
}
