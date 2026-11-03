// Verification from the browser alone, with no Chain of Record server: the
// page reads the CredentialRegistry smart contract through a public Ethereum
// RPC, fetches the encrypted certificate from IPFS, decrypts it with the key
// from the QR link, recomputes its SHA-256 and compares it with the contract.

import { Contract, JsonRpcProvider } from 'ethers';
import { CHAIN } from './wallet';
import { chainIdOf, documentString, sha256Hex } from './certificateView';

const GATEWAYS = ['https://gateway.pinata.cloud/ipfs', 'https://ipfs.io/ipfs', 'https://dweb.link/ipfs'];

let readOnly = null;
export function contract() {
  if (!CHAIN.address || !CHAIN.rpcUrl) throw new Error('No contract is configured for this website.');
  readOnly ??= new Contract(CHAIN.address, CHAIN.abi, new JsonRpcProvider(CHAIN.rpcUrl, CHAIN.chainId, { staticNetwork: true }));
  return readOnly;
}

const hexToBytes = (hex) => Uint8Array.from(hex.match(/../g).map((b) => parseInt(b, 16)));

/** Downloads the encrypted document from any IPFS gateway and decrypts it (AES-256-GCM). */
export async function fetchDocument(cid, keyHex) {
  let bytes = null;
  for (const gateway of GATEWAYS) {
    try {
      const res = await fetch(`${gateway}/${cid}`, { signal: AbortSignal.timeout(15000) });
      if (res.ok) {
        bytes = new Uint8Array(await res.arrayBuffer());
        break;
      }
    } catch {
      // try the next gateway
    }
  }
  if (!bytes) throw new Error('The certificate document could not be fetched from IPFS.');
  const key = await crypto.subtle.importKey('raw', hexToBytes(keyHex), 'AES-GCM', false, ['decrypt']);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12) }, key, bytes.slice(12));
  return JSON.parse(new TextDecoder().decode(plain));
}

/**
 * @param {{ certificateNo: string, hash: string, ipfs?: { cid: string, key: string } }} qr  from parseQrPayload
 * @returns {Promise<{ verdict: 'valid'|'invalid'|'revoked', reason: string, steps: object[], document?: object, chain: object }>}
 */
export async function verifyFromQr(qr) {
  const steps = [];
  const step = (label, ok, detail) => steps.push({ label, ok, detail });
  const registry = contract();
  const docHash = `0x${qr.hash}`;
  const credentialId = chainIdOf(qr.certificateNo);

  let document = null;
  if (qr.ipfs) {
    document = await fetchDocument(qr.ipfs.cid, qr.ipfs.key);
    step('Fetched the encrypted certificate from IPFS and decrypted it', true, `CID ${qr.ipfs.cid}`);
    const recomputed = `0x${await sha256Hex(documentString(document.canonical, document.semesters))}`;
    const same = recomputed === docHash;
    step('Recomputed SHA-256 of the document equals the hash in the QR', same, recomputed);
    if (!same) return { verdict: 'invalid', reason: 'The document on IPFS does not match the QR code.', steps, document, chain: {} };
  }

  const batch = document?.chain?.batchId ? document.chain : null;
  let issuer, issuerActive, revoked, included;
  if (batch) {
    const r = await registry.verifyBatchCredential(batch.batchId, credentialId, docHash, batch.merkleProof);
    ({ issuer, issuerActive } = r);
    included = r.included;
    revoked = Number(r.revokedAt) > 0;
    step(`Merkle proof: the certificate belongs to batch ${batch.batchId} anchored in the contract`, included, `root ${batch.merkleRoot}`);
  } else {
    const [credential, active] = await registry.getCredential(credentialId);
    issuer = credential.issuer;
    issuerActive = active;
    included = Number(credential.status) !== 0 && credential.docHash.toLowerCase() === docHash;
    revoked = Number(credential.status) === 2;
    step('The contract holds this credential ID with exactly this document hash', included, credential.docHash);
  }
  const chain = { network: CHAIN.network, contract: CHAIN.address, issuer, credentialId };
  if (!included) return { verdict: 'invalid', reason: 'This certificate is not recorded in the smart contract.', steps, document, chain };

  const issuerInfo = await registry.issuers(issuer);
  chain.issuerName = issuerInfo.name;
  step('Signed by an issuer the platform has authorised in the contract', issuerActive, `${issuerInfo.name} (${issuer})`);
  if (!issuerActive) return { verdict: 'invalid', reason: 'The issuing university is not (or no longer) authorised.', steps, document, chain };

  const txHash = document?.chain?.txHash;
  if (txHash) {
    const provider = registry.runner.provider;
    const [receipt, latest] = await Promise.all([provider.getTransactionReceipt(txHash), provider.getBlockNumber()]);
    if (receipt) {
      Object.assign(chain, { txHash, blockNumber: receipt.blockNumber, confirmations: latest - receipt.blockNumber + 1 });
      step(`Issued in block ${receipt.blockNumber}, ${latest - receipt.blockNumber + 1} blocks deep`, receipt.status === 1, txHash);
    }
  }
  step('Revocation status read from the contract', true, revoked ? 'revoked' : 'not revoked');
  return revoked
    ? { verdict: 'revoked', reason: 'Genuine, but revoked by the university in the smart contract.', steps, document, chain }
    : { verdict: 'valid', reason: 'Genuine: the smart contract confirms this exact document.', steps, document, chain };
}

/** Contract totals and the latest events, for the Blockchain page. */
export async function contractOverview(limit = 25) {
  const registry = contract();
  const provider = registry.runner.provider;
  const [owner, paused, totalIssued, totalRevoked, batchCount, latest] = await Promise.all([
    registry.owner(), registry.paused(), registry.totalIssued(), registry.totalRevoked(), registry.batchCount(), provider.getBlockNumber(),
  ]);
  const from = CHAIN.deploymentBlock;
  const kinds = ['IssuerUpdated', 'CredentialIssued', 'BatchAnchored', 'CredentialRevoked'];
  const lists = await Promise.all(kinds.map((k) => registry.queryFilter(registry.filters[k](), from, latest)));
  const events = lists
    .flat()
    .sort((a, b) => b.blockNumber - a.blockNumber || b.index - a.index)
    .slice(0, limit)
    .map((e) => ({
      name: e.fragment.name,
      blockNumber: e.blockNumber,
      txHash: e.transactionHash,
      confirmations: latest - e.blockNumber + 1,
      args: Object.fromEntries(e.fragment.inputs.map((input, i) => [input.name, String(e.args[i])])),
    }));
  return {
    network: CHAIN.network,
    contract: CHAIN.address,
    owner,
    paused,
    totalIssued: Number(totalIssued),
    totalRevoked: Number(totalRevoked),
    batchCount: Number(batchCount),
    latestBlock: latest,
    deploymentBlock: from,
    events,
  };
}

/** One block as Ethereum reports it: hash, parent hash, time, transaction count. */
export async function blockDetails(number) {
  const block = await contract().runner.provider.getBlock(number);
  return block && { number: block.number, hash: block.hash, parentHash: block.parentHash, timestamp: block.timestamp, transactions: block.transactions.length, miner: block.miner, gasUsed: String(block.gasUsed) };
}
