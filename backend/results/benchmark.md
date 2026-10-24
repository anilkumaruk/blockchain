# Chain of Record — Performance Evaluation

Generated: 2026-10-23T17:12:17.041Z
Environment: Hardhat in-process EVM (instant mining), Node v20.20.2, N = 50 credentials

## Gas usage

| Operation | Avg gas | Min | Max |
|---|---:|---:|---:|
| Deploy registry (one-time) | 1638249 | – | – |
| Issue credential | 124957 | 124604 | 141716 |
| Revoke credential | 44546 | 42836 | 59936 |
| Verify (view call) | 0 (free) | – | – |

### Estimated cost per operation

| Network | Issue | Revoke |
|---|---:|---:|
| Ethereum L1 (~10 gwei) | 0.001250 ETH | 0.000445 ETH |
| Low-fee L2 (~0.05 gwei) | 0.000006 ETH | 0.000002 ETH |

## Merkle batch issuance

One transaction anchors one Merkle root; each credential keeps a proof off-chain.

| Batch size | Total gas | Gas per credential | vs individual | Proof length | API time | Verify member |
|---:|---:|---:|---:|---:|---:|---:|
| 10 | 122934 | 12293 | 9.84% | 4 hashes | 8.1 ms | 2.5 ms |
| 50 | 105834 | 2117 | 1.69% | 6 hashes | 13.1 ms | 2.4 ms |
| 100 | 105834 | 1058 | 0.85% | 7 hashes | 20.8 ms | 2.4 ms |
| 250 | 105822 | 423 | 0.34% | 8 hashes | 43.6 ms | 2.5 ms |
| 500 | 105834 | 212 | 0.17% | 9 hashes | 82.2 ms | 2.9 ms |

## End-to-end API latency (local stack)

| Operation | Avg | p50 | p95 | Max |
|---|---:|---:|---:|---:|
| Issue (hash + tx + DB) | 3.7 ms | 3.2 ms | 5.8 ms | 11.9 ms |
| Revoke | 3.2 ms | 3.2 ms | 4.3 ms | 4.3 ms |
| Verify by credential ID | 1.5 ms | 1.3 ms | 1.6 ms | 6.9 ms |
| Verify by PDF upload | 1.5 ms | 1.4 ms | 2.3 ms | 2.6 ms |

On a public testnet, issue/revoke latency is dominated by block confirmation
(~12 s per block on Sepolia); verification stays a free read-only call.

## Storage footprint

| Item | Size |
|---|---:|
| On-chain per credential (individual) | 128 bytes (4 storage slots, fixed) |
| On-chain per batch (any size) | 96 bytes (3 storage slots: root, issuer+time+count, root-used flag) |
| Certificate PDF (off-chain) | avg 1694 bytes |
| Personal data on-chain | none (name, student ID, course stay off-chain) |

## Detection accuracy

| Check | Result |
|---|---:|
| Genuine certificates verified as valid | 50/50 (100.0%) |
| Single-byte tampered PDFs rejected | 50/50 (100.0%) |
| Revoked credentials reported as revoked | 10/10 (100.0%) |
