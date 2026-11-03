// SHA-256 helpers for the server. The browser computes the same document hash
// with Web Crypto (src/lib/certificateView.js), so both always agree.

import crypto from 'node:crypto';
import { documentString } from '../../src/lib/certificateView.js';

export const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');

/** The docHash recorded in the smart contract, as 0x-prefixed hex. */
export const documentHash = (canonical, semesters = []) => `0x${sha256(documentString(canonical, semesters))}`;
