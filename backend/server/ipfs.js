// IPFS storage for certificate documents, through Pinata.
//
// Each document is encrypted with its own random AES-256-GCM key before upload,
// so IPFS only ever holds ciphertext. The key goes to the student (inside the
// QR link, after "#"), who decides who may read the document. A verifier fetches
// the ciphertext from any IPFS gateway, decrypts it and recomputes the hash that
// the smart contract holds - without asking this server.
//
// Stored bytes: 12-byte IV, then ciphertext, then the 16-byte GCM tag (the order
// Web Crypto's AES-GCM expects, so the browser can decrypt it directly).

import crypto from 'node:crypto';

const PIN_URL = 'https://api.pinata.cloud/pinning/pinFileToIPFS';
export const DEFAULT_GATEWAY = 'https://gateway.pinata.cloud/ipfs';

export function encryptDocument(document, key = crypto.randomBytes(32)) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(document), 'utf8'), cipher.final()]);
  return { bytes: Buffer.concat([iv, body, cipher.getAuthTag()]), key: key.toString('hex') };
}

export function decryptDocument(bytes, keyHex) {
  const buf = Buffer.from(bytes);
  const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(buf.length - 16));
  return JSON.parse(Buffer.concat([decipher.update(buf.subarray(12, buf.length - 16)), decipher.final()]).toString('utf8'));
}

/**
 * @param {{ jwt?: string, gateway?: string, fetchImpl?: typeof fetch, timeoutMs?: number }} options
 * @returns null when no Pinata JWT is configured (IPFS is then simply not used)
 */
export function createIpfs({ jwt, gateway = DEFAULT_GATEWAY, fetchImpl = fetch, timeoutMs = 20_000 } = {}) {
  if (!jwt) return null;
  return {
    gateway,
    /** Encrypts and pins one document. Returns { cid, key }. */
    async pinEncrypted(document, name) {
      const { bytes, key } = encryptDocument(document);
      const form = new FormData();
      form.append('file', new Blob([bytes], { type: 'application/octet-stream' }), `${name}.enc`);
      form.append('pinataMetadata', JSON.stringify({ name: `${name}.enc` }));
      const res = await fetchImpl(PIN_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${jwt}` },
        body: form,
        signal: AbortSignal.timeout(timeoutMs),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.IpfsHash) throw new Error(`IPFS upload failed (${res.status}): ${data.error?.details ?? data.error ?? 'no CID'}`);
      return { cid: data.IpfsHash, key };
    },
  };
}
