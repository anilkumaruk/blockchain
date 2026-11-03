// REST API for Chain of Record.
//
// The blockchain is the CredentialRegistry smart contract on Ethereum. This
// server holds no keys and never writes to the chain: universities and the
// platform admin sign every transaction in their own MetaMask. The server
//   - prepares what is signed (the certificate's document hash),
//   - confirms each write by reading the contract before recording it,
//   - verifies certificates by reading the contract,
//   - keeps the personal data (PostgreSQL) and the encrypted documents (IPFS).
// Response shapes mirror src/lib/mockApi.js so the pages work with either.

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { keccak256, toUtf8Bytes } from 'ethers';
import { ChainUnavailableError, ContractRevertError } from './chain.js';
import { buildMerkleTree, leafOf } from './merkle.js';
import { verifyCertificateEvidence } from './photoVerify.js';
import { documentHash } from './hash.js';
import { chainIdOf, degreeCanonical, issuedCanonical, viewFromCredential, viewFromDegree } from '../../src/lib/certificateView.js';
import { createInstitutionService } from './institutions.js';
import { hashPassword } from './passwords.js';

const ID_PATTERN = /^[A-Za-z0-9-]{4,40}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const HASH_PATTERN = /^(0x)?[0-9a-f]{64}$/i;
const TX_PATTERN = /^0x[0-9a-f]{64}$/i;
const MAX_TEXT = 200;
const EMAIL_PATTERN = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const MAX_BATCH = 500;

const REVERT_STATUS = {
  CredentialAlreadyExists: 409,
  HashAlreadyRegistered: 409,
  RootAlreadyAnchored: 409,
  AlreadyRevoked: 409,
  CredentialNotFound: 404,
  BatchNotFound: 404,
  NotAuthorizedIssuer: 403,
  NotOriginalIssuer: 403,
  OwnableUnauthorizedAccount: 403,
  EnforcedPause: 423,
};

class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

const randomHex = (bytes) => Buffer.from(crypto.getRandomValues(new Uint8Array(bytes))).toString('hex');
const today = () => new Date().toISOString().slice(0, 10);
const asyncRoute = (fn) => (req, res, next) => fn(req, res, next).catch(next);
const sameAddress = (a, b) => Boolean(a && b) && String(a).toLowerCase() === String(b).toLowerCase();
const hex64 = (hash) => String(hash).toLowerCase().replace(/^0x/, '');

/** The revocation reason exactly as hashed into the contract (the browser does the same). */
export const normalizeReason = (reason) => String(reason ?? '').trim().slice(0, 500) || 'No reason provided.';

function limiter(enabled, windowMs, limit) {
  if (!enabled) return (_req, _res, next) => next();
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many requests. Please slow down and try again later.', code: 'rate_limited' },
  });
}

/**
 * @param {{
 *   chain: ReturnType<import('./chain.js').createChainBridge>,   // read-only contract access
 *   store: ReturnType<import('./store.js').createMemoryStore>,
 *   auth: ReturnType<import('./auth.js').createAuth>,
 *   ipfs?: ReturnType<import('./ipfs.js').createIpfs>,          // null: IPFS not configured
 *   network?: { name: string, chainId: number, explorer?: string },
 *   corsOrigin?: string | string[] | boolean,
 *   rateLimits?: boolean,
 *   trustProxy?: boolean | number | string,
 * }} deps
 */
export function createApp({
  chain,
  store,
  auth,
  ipfs = null,
  network = { name: 'localhost', chainId: 31337 },
  corsOrigin = true,
  rateLimits = true,
  trustProxy = false,
}) {
  const app = express();
  app.set('trust proxy', trustProxy);
  app.use(helmet());
  app.use(cors({ origin: corsOrigin }));

  const loginLimit = limiter(rateLimits, 15 * 60 * 1000, 20);
  const verifyLimit = limiter(rateLimits, 60 * 1000, 120);
  const writeLimit = limiter(rateLimits, 60 * 1000, 60);

  const audit = (req, action, target = null, details = null) =>
    store.addAudit({ actor: req.user?.sub ?? null, action, target, ip: req.ip, details });

  const institutions = createInstitutionService({ chain, store });
  const actingInstitution = async (req) => {
    try {
      return await institutions.forUser(req.user);
    } catch (err) {
      throw new HttpError(err.status ?? 403, err.message);
    }
  };
  // A university manages only its own credentials.
  const mayManage = (record, actor) => record.institutionId === actor.id;

  // ---- reading the contract -------------------------------------------------

  /** What the contract says about one stored credential (individual or Merkle batch). */
  async function onChainFor(record) {
    const chainView = record.batch
      ? await chain.verifyBatch({
          batchId: record.batch.batchId,
          credentialId: record.credentialId,
          hash: record.hash,
          proof: record.batch.proof,
        })
      : await chain.getById(record.credentialId);
    if (!chainView) return null;
    const txHash = record.chain?.txHash;
    const tx = txHash && TX_PATTERN.test(txHash) ? await chain.transaction(txHash) : null;
    return {
      ...chainView,
      docHash: chainView.hash,
      proof: {
        network: network.name,
        contract: await chain.address(),
        mode: record.batch ? 'merkle-batch' : 'individual',
        txHash: tx?.txHash ?? txHash ?? null,
        blockNumber: tx?.blockNumber ?? record.chain?.blockNumber ?? null,
        blockHash: tx?.blockHash ?? null,
        confirmations: tx?.confirmations ?? null,
        ...(record.batch
          ? { batchId: record.batch.batchId, merkleRoot: record.batch.root, merkleProof: record.batch.proof, merkleProofValid: true }
          : {}),
      },
    };
  }

  // ---- issuance helpers ----------------------------------------------------

  function validateIssueInput(body, issuerName, { requireId = false } = {}) {
    if (requireId && !body.credentialId) throw new HttpError(400, 'credentialId is required.');
    const fields = {
      studentName: String(body.studentName ?? '').trim(),
      studentId: String(body.studentId ?? '').trim(),
      credentialType: String(body.credentialType ?? '').trim(),
      issueDate: body.issueDate ? String(body.issueDate) : today(),
      credentialId: body.credentialId
        ? String(body.credentialId).trim()
        : `COR-${new Date().getFullYear()}-${randomHex(3).toUpperCase()}`,
      issuer: issuerName,
    };
    const missing = ['studentName', 'studentId', 'credentialType'].filter((k) => !fields[k]);
    if (missing.length) throw new HttpError(400, `Missing required field(s): ${missing.join(', ')}.`);
    if (['studentName', 'studentId', 'credentialType'].some((k) => fields[k].length > MAX_TEXT)) {
      throw new HttpError(400, `Fields must be at most ${MAX_TEXT} characters.`);
    }
    if (!ID_PATTERN.test(fields.credentialId)) throw new HttpError(400, 'Invalid credential ID format.');
    if (!DATE_PATTERN.test(fields.issueDate) || Number.isNaN(Date.parse(fields.issueDate))) {
      throw new HttpError(400, 'issueDate must be a valid YYYY-MM-DD date.');
    }
    return fields;
  }

  // The server, not the browser, decides what gets hashed.
  const docHashOf = (fields) => documentHash(issuedCanonical(fields));

  function validateStudentEmail(value) {
    if (value == null || value === '') return null;
    const email = String(value).trim().toLowerCase();
    if (!EMAIL_PATTERN.test(email)) throw new HttpError(400, 'studentEmail is not a valid email address.');
    return email;
  }

  async function assertEmailFree(email, studentId) {
    if (!email) return;
    const owner = await store.findStudentByEmail(email);
    if (owner && owner.studentId !== studentId) {
      throw new HttpError(409, 'That student email already belongs to another student.');
    }
  }

  // Keeps the institution's student register in step with what it issues, so
  // the student can later create a login with their personal email.
  async function recordStudent(fields, email, institution) {
    try {
      await store.upsertStudent({ studentId: fields.studentId, fullName: fields.studentName, email, institutionId: institution.id });
    } catch (err) {
      if (err.code === '23505') throw new HttpError(409, 'That student email already belongs to another student.');
      throw err;
    }
  }

  async function confirmedTransaction(txHash) {
    if (txHash == null) return null;
    if (!TX_PATTERN.test(String(txHash))) throw new HttpError(400, 'txHash must be a 0x-prefixed transaction hash.');
    const tx = await chain.transaction(txHash);
    if (!tx || !tx.succeeded || !tx.toContract) {
      throw new HttpError(409, 'That transaction is not a successful call to this contract (yet).', { code: 'tx_not_confirmed' });
    }
    return tx;
  }

  // ---- IPFS -------------------------------------------------------------------

  /** The document stored (encrypted) on IPFS: everything needed to re-check it. */
  function ipfsDocument(record, view, semesters) {
    return {
      v: 1,
      credentialId: record.credentialId,
      certificateNo: view.certificateNo,
      canonical: view.canonical,
      semesters: semesters ?? [],
      docHash: record.hash,
      view,
      chain: {
        network: network.name,
        chainId: network.chainId,
        txHash: record.chain?.txHash ?? null,
        blockNumber: record.chain?.blockNumber ?? null,
        ...(record.batch ? { batchId: record.batch.batchId, merkleRoot: record.batch.root, merkleProof: record.batch.proof } : {}),
      },
    };
  }

  /** Best effort: a record without an IPFS copy still verifies through the contract. */
  async function ensurePinned(record, view, semesters) {
    if (!ipfs || record.ipfs) return record.ipfs ?? null;
    try {
      const pinned = await ipfs.pinEncrypted(ipfsDocument(record, view, semesters), record.credentialId);
      await store.update(record.credentialId, { ipfs: pinned });
      return pinned;
    } catch (err) {
      console.error(`[ipfs] ${record.credentialId}: ${err.message}`);
      return null;
    }
  }

  // Everything printed on a downloaded marks card, confirmed against the contract.
  async function printableCard(degree, credential) {
    const view = degree ? viewFromDegree(degree) : viewFromCredential(credential);
    const marks = degree ? await store.getMarks(degree.enrollment_id) : null;
    if (marks) Object.assign(view, { semesters: marks.semesters, batch: marks.batch, medium: marks.medium });
    const record = credential ?? (await store.get(degree.credential_id));
    if (!record) {
      return { view, hash: null, txId: null, block: null, status: 'unknown', marksVerified: false, ipfs: null };
    }
    const onChain = await onChainFor(record);
    const recomputed = documentHash(view.canonical, marks?.semesters ?? []);
    const matches = Boolean(onChain) && recomputed === onChain.docHash && recomputed === record.hash;
    const pinned = await ensurePinned(record, view, marks?.semesters);
    return {
      view,
      hash: hex64(record.hash),
      txId: record.chain?.txHash ?? null,
      block: record.chain?.blockNumber ?? null,
      status: matches ? onChain.status : 'unknown',
      marksVerified: matches,
      ipfs: pinned,
      chain: onChain?.proof ?? null,
    };
  }

  // ---- verification --------------------------------------------------------

  // The contract is the source of truth for hash and status; the stored
  // record only supplies human-readable details, and is itself cross-checked.
  async function evaluate(onChain, record, query) {
    const trusted = onChain.issuerActive ? await institutions.trustedByAddress(onChain.issuer) : null;
    if (!trusted) {
      return {
        status: 'invalid',
        code: 'untrusted_issuer',
        details: { reason: 'This credential was not issued by an institution approved on this platform.', issuer: onChain.issuer, ...query },
      };
    }
    if (record && record.hash !== onChain.docHash) return recordMismatch(query);
    const details = {
      ...(record ?? { credentialId: query.submittedId ?? null, issuer: trusted.name }),
      issuerInstitution: { id: trusted.id, name: trusted.name, address: onChain.issuer },
      hash: onChain.docHash,
      status: onChain.status,
      onChain,
    };
    return { status: onChain.status === 'revoked' ? 'revoked' : 'valid', code: onChain.status, details };
  }

  const recordMismatch = (query) => ({
    status: 'invalid',
    code: 'record_mismatch',
    details: { reason: 'The institution record does not match the document hash in the smart contract.', ...query },
  });

  const findRecord = async (submitted) =>
    (await store.get(submitted)) ?? (await store.findByCertificateNo(submitted)) ?? (await store.get(chainIdOf(submitted)));

  // Accepts our credential ID or the number printed on the certificate.
  async function verifyById(submitted) {
    const record = await findRecord(submitted);
    const query = { submittedId: submitted };
    const onChain = record ? await onChainFor(record) : await chain.getById(submitted).then((c) => c && { ...c, docHash: c.hash });
    if (onChain) return evaluate(onChain, record, query);
    return {
      status: 'invalid',
      code: 'not_found',
      details: { reason: `No credential found in the smart contract matching ID "${submitted}".`, submittedId: submitted, submittedHash: null },
    };
  }

  async function verifyByHash(hashInput) {
    const hash = '0x' + hex64(hashInput);
    const query = { submittedHash: hash };
    const individual = await chain.getByHash(hash);
    if (individual) return evaluate({ ...individual, docHash: individual.hash }, await store.findByHash(hash), query);
    const record = await store.findByHash(hash);
    const onChain = record?.batch ? await onChainFor(record) : null;
    if (onChain) return evaluate(onChain, record, query);
    return {
      status: 'invalid',
      code: 'hash_mismatch',
      details: {
        reason: 'This document hash is not in the smart contract. The certificate may have been altered, or was never issued through this system.',
        submittedId: null,
        submittedHash: hash,
      },
    };
  }

  // ---- routes: public --------------------------------------------------------

  app.get(
    '/api/health',
    asyncRoute(async (_req, res) => {
      try {
        const [contract, paused] = await Promise.all([chain.address(), chain.paused()]);
        res.json({ ok: true, chain: 'reachable', network: network.name, contract, paused, store: store.kind, ipfs: Boolean(ipfs) });
      } catch {
        res.status(503).json({ ok: false, chain: 'unavailable', store: store.kind });
      }
    })
  );

  app.post(
    '/api/auth/login',
    loginLimit,
    express.json({ limit: '10kb' }),
    asyncRoute(async (req, res) => {
      const username = String(req.body?.username ?? '').slice(0, 100);
      const result = await auth.login(username, req.body?.password);
      if (!result.ok) {
        await store.addAudit({ actor: username || null, action: 'login_failed', ip: req.ip, details: { reason: result.reason } });
        if (result.reason === 'locked') {
          return res.status(423).json({ error: 'Account temporarily locked after repeated failed sign-ins.', code: 'locked' });
        }
        if (result.reason === 'pending' || result.reason === 'suspended') {
          return res.status(403).json({
            error:
              result.reason === 'pending'
                ? 'Your institution is awaiting approval by the platform administrator.'
                : 'Your institution has been suspended. Contact the platform administrator.',
            code: result.reason,
          });
        }
        return res.status(401).json({ error: 'Invalid email/username or password.' });
      }
      await store.addAudit({ actor: result.session.sub, action: 'login', ip: req.ip });
      res.json(result.session);
    })
  );

  // Students create a login with the personal email their institution holds
  // on record for them; anyone else's email is refused.
  app.post(
    '/api/auth/register/student',
    loginLimit,
    express.json({ limit: '10kb' }),
    asyncRoute(async (req, res) => {
      const email = String(req.body?.email ?? '').trim().toLowerCase();
      if (!EMAIL_PATTERN.test(email)) throw new HttpError(400, 'Enter a valid email address.');
      const student = await store.findStudentByEmail(email);
      if (!student) {
        await store.addAudit({ actor: email, action: 'student_register_refused', ip: req.ip });
        throw new HttpError(404, 'No student record uses this email. Ask your institution to add your personal email to your record.', {
          code: 'no_student_record',
        });
      }
      let passwordHash;
      try {
        passwordHash = await hashPassword(String(req.body?.password ?? ''));
      } catch (err) {
        throw new HttpError(400, err.message);
      }
      try {
        await store.createUser({ username: email, email, passwordHash, role: 'student', studentId: student.studentId, institutionId: student.institutionId });
      } catch (err) {
        if (err.code === '23505') throw new HttpError(409, 'An account already exists for this email. Sign in instead.');
        throw err;
      }
      await store.addAudit({ actor: email, action: 'student_registered', target: student.studentId, ip: req.ip });
      res.status(201).json({ ok: true, studentId: student.studentId, fullName: student.fullName });
    })
  );

  // Any institution can apply with the MetaMask address it will sign with; it
  // can issue only after the platform admin authorises that address on-chain.
  app.post(
    '/api/institutions/register',
    loginLimit,
    express.json({ limit: '10kb' }),
    asyncRoute(async (req, res) => {
      const b = req.body ?? {};
      const name = String(b.name ?? '').trim();
      const email = String(b.email ?? '').trim().toLowerCase();
      const website = b.website ? String(b.website).trim() : null;
      const kind = ['university', 'certifying_body', 'employer', 'other'].includes(b.kind) ? b.kind : 'university';
      if (name.length < 3 || name.length > MAX_TEXT) throw new HttpError(400, 'Enter the institution name (3-200 characters).');
      if (!EMAIL_PATTERN.test(email)) throw new HttpError(400, 'Enter a valid official email address.');
      if (website && !/^https?:\/\/[^\s]+\.[^\s]+$/i.test(website)) throw new HttpError(400, 'Website must start with http:// or https://.');
      let passwordHash;
      try {
        passwordHash = await hashPassword(String(b.password ?? ''));
      } catch (err) {
        throw new HttpError(400, err.message);
      }
      if (await store.findUserForLogin(email)) throw new HttpError(409, 'An account already exists for this email.');
      let inst;
      try {
        inst = await institutions.register({ name, kind, email, website, walletAddress: String(b.walletAddress ?? '').trim() });
      } catch (err) {
        throw new HttpError(err.status ?? 400, err.message);
      }
      await store.createUser({ username: email, email, passwordHash, role: 'institution', institutionId: inst.id });
      await store.addAudit({ actor: email, action: 'institution_registered', target: inst.id, ip: req.ip });
      res.status(201).json({ ok: true, institution: institutions.publicView(inst) });
    })
  );

  // Public directory of approved issuers, so verifiers can see who is trusted.
  app.get(
    '/api/institutions',
    verifyLimit,
    asyncRoute(async (_req, res) => {
      const list = (await store.listInstitutions())
        .filter((i) => i.status === 'approved')
        .map(({ id, name, kind, website, walletAddress }) => ({ id, name, kind, website, walletAddress }));
      res.json(list);
    })
  );

  app.get(
    '/api/me',
    auth.authenticate,
    asyncRoute(async (req, res) => {
      const inst = req.user.institutionId ? await store.getInstitution(req.user.institutionId) : null;
      const student = req.user.studentId ? await store.getStudent(req.user.studentId) : null;
      res.json({
        username: req.user.sub,
        role: req.user.role,
        studentId: req.user.studentId ?? null,
        fullName: student?.fullName ?? null,
        institution: inst ? { id: inst.id, name: inst.name, status: inst.status, walletAddress: inst.walletAddress } : null,
      });
    })
  );

  // Printable certificates, with the document hash and IPFS link for their QR code.
  app.get(
    '/api/me/certificates',
    ...auth.requireRole('student'),
    asyncRoute(async (req, res) => {
      const degrees = await store.listDegreeRecordsForStudent(req.user.studentId);
      const known = new Set(degrees.map((d) => d.credential_id));
      const others = (await store.listByStudent(req.user.studentId)).filter((c) => !known.has(c.credentialId));
      res.json(await Promise.all([...degrees.map((d) => printableCard(d, null)), ...others.map((c) => printableCard(null, c))]));
    })
  );

  app.get(
    '/api/me/credentials',
    ...auth.requireRole('student'),
    asyncRoute(async (req, res) => res.json(await store.listByStudent(req.user.studentId)))
  );

  // Public read for the shared student profile page.
  app.get(
    '/api/students/:studentId/credentials',
    verifyLimit,
    asyncRoute(async (req, res) => res.json(await store.listByStudent(req.params.studentId)))
  );

  app.get(
    '/api/credentials/:id/history',
    verifyLimit,
    asyncRoute(async (req, res) => {
      const record = await store.get(req.params.id);
      const events = await chain.history(req.params.id, record?.batch?.batchId);
      if (!record && events.length === 0) throw new HttpError(404, 'Credential not found.');
      res.json({ credentialId: req.params.id, events });
    })
  );

  app.get(
    '/api/verify/:credentialId',
    verifyLimit,
    asyncRoute(async (req, res) => res.json(await verifyById(req.params.credentialId.trim())))
  );

  app.post(
    '/api/verify/hash',
    verifyLimit,
    express.json({ limit: '10kb' }),
    asyncRoute(async (req, res) => {
      if (!HASH_PATTERN.test(String(req.body?.hash ?? ''))) throw new HttpError(400, 'hash must be a 32-byte hex SHA-256 digest.');
      res.json(await verifyByHash(req.body.hash));
    })
  );

  // Certificate photo: the browser sends what it read from the picture (OCR
  // text and any QR code); the answer is valid, invalid or revoked.
  app.post(
    '/api/verify/photo',
    verifyLimit,
    express.json({ limit: '64kb' }),
    asyncRoute(async (req, res) => {
      const ocrText = String(req.body?.ocrText ?? '').slice(0, 20000);
      const qrText = String(req.body?.qrText ?? '').slice(0, 2000);
      if (!ocrText.trim() && !qrText.trim()) throw new HttpError(400, 'No text or QR code was read from the photo.');
      res.json(
        await verifyCertificateEvidence(
          { ocrText, qrText },
          {
            findDegree: (no) => store.findDegreeRecord(no),
            findCredential: (no) => store.findCertificateNoInsensitive(no),
            onChain: async ({ degree, credential, number }) => {
              const record = credential ?? (degree ? await store.get(degree.credential_id) : await findRecord(number));
              return record ? onChainFor(record) : null;
            },
            issuerTrusted: (address) => institutions.trustedByAddress(address),
            findMarks: async (enrollmentId) => (await store.getMarks(enrollmentId))?.semesters ?? null,
            knownPrefixes: async () => (await store.listInstitutions()).map((i) => i.shortCode).filter(Boolean),
          }
        )
      );
    })
  );

  // ---- routes: universities (sign in MetaMask, the server confirms) ----------

  // Platform admin: approves institutions, registry controls, audit log.
  const admin = auth.requireRole('admin');
  // University registrars: issue, revoke and list their own credentials.
  const issuer = auth.requireRole('institution');

  // Step 1 of issuing: the document hash the university will sign in MetaMask.
  app.post(
    '/api/credentials/prepare',
    ...issuer,
    writeLimit,
    express.json({ limit: '20kb' }),
    asyncRoute(async (req, res) => {
      const inst = await actingInstitution(req);
      const fields = validateIssueInput(req.body ?? {}, inst.name);
      await assertEmailFree(validateStudentEmail(req.body?.studentEmail), fields.studentId);
      if (await store.get(fields.credentialId)) throw new HttpError(409, `Credential ID "${fields.credentialId}" already exists.`);
      const docHash = docHashOf(fields);
      const existing = await chain.getById(fields.credentialId);
      if (existing && existing.hash !== docHash) {
        throw new HttpError(409, `Credential ID "${fields.credentialId}" is already in the smart contract for another document.`);
      }
      res.json({ credentialId: fields.credentialId, docHash, issuerAddress: inst.walletAddress, alreadyOnChain: Boolean(existing), fields });
    })
  );

  // Step 2: after the MetaMask transaction is mined, record it - but only what
  // the contract confirms: this ID, this exact hash, signed by this university.
  app.post(
    '/api/credentials',
    ...issuer,
    writeLimit,
    express.json({ limit: '20kb' }),
    asyncRoute(async (req, res) => {
      const inst = await actingInstitution(req);
      const fields = validateIssueInput(req.body ?? {}, inst.name, { requireId: true });
      const email = validateStudentEmail(req.body?.studentEmail);
      await assertEmailFree(email, fields.studentId);
      if (await store.get(fields.credentialId)) throw new HttpError(409, `Credential ID "${fields.credentialId}" already exists.`);

      const docHash = docHashOf(fields);
      const onChain = await chain.getById(fields.credentialId);
      if (!onChain) {
        throw new HttpError(409, 'The smart contract has no credential with this ID yet. Sign it in MetaMask and wait for the transaction to be mined.', {
          code: 'not_on_chain',
        });
      }
      if (onChain.hash !== docHash) throw new HttpError(409, 'The hash in the smart contract does not match these details.', { code: 'hash_mismatch' });
      if (!sameAddress(onChain.issuer, inst.walletAddress)) {
        throw new HttpError(403, "This credential was signed by another wallet, not your institution's.", { code: 'wrong_issuer' });
      }
      const tx = await confirmedTransaction(req.body?.txHash);

      let replaces = null;
      if (req.body?.replaces) {
        const old = await store.get(String(req.body.replaces));
        if (!old || !mayManage(old, inst)) throw new HttpError(403, 'Only the institution that issued a credential can replace it.');
        if (old.status !== 'revoked') throw new HttpError(409, 'Revoke the old credential before issuing its replacement.');
        replaces = old.credentialId;
      }

      const record = await store.insert({
        ...fields,
        txHash: tx?.txHash ?? docHash,
        hash: docHash,
        status: onChain.status,
        revocation: null,
        institutionId: inst.id,
        issuerAddress: inst.walletAddress,
        replaces,
        chain: { mode: 'individual', network: network.name, contract: await chain.address(), txHash: tx?.txHash ?? null, blockNumber: tx?.blockNumber ?? null },
      });
      if (replaces) await store.update(replaces, { replacedBy: record.credentialId });
      await recordStudent(fields, email, inst);
      await ensurePinned(record, viewFromCredential(record), []);
      await audit(req, replaces ? 'credential_reissued' : 'credential_issued', record.credentialId, {
        txHash: record.chain.txHash,
        institution: inst.id,
        ...(replaces ? { replaces } : {}),
      });
      res.status(201).json({ credentialId: record.credentialId, hash: docHash, txHash: record.chain.txHash, record: await store.get(record.credentialId) });
    })
  );

  function validateBatch(items, inst, requireId) {
    if (!Array.isArray(items) || items.length === 0) throw new HttpError(400, 'credentials must be a non-empty array.');
    if (items.length > MAX_BATCH) throw new HttpError(400, `A batch can hold at most ${MAX_BATCH} credentials.`);
    const fieldsList = items.map((item, i) => {
      try {
        return validateIssueInput(item ?? {}, inst.name, { requireId });
      } catch (err) {
        throw new HttpError(400, `Item ${i}: ${err.message}`);
      }
    });
    const ids = new Set();
    for (const f of fieldsList) {
      if (ids.has(f.credentialId)) throw new HttpError(409, `Duplicate credential ID "${f.credentialId}" in batch.`);
      ids.add(f.credentialId);
    }
    const hashes = fieldsList.map(docHashOf);
    return { fieldsList, hashes, tree: buildMerkleTree(fieldsList.map((f, i) => leafOf(f.credentialId, hashes[i]))) };
  }

  // Merkle batch, step 1: one root covering many credentials, signed once.
  app.post(
    '/api/credentials/batch/prepare',
    ...issuer,
    writeLimit,
    express.json({ limit: '1mb' }),
    asyncRoute(async (req, res) => {
      const inst = await actingInstitution(req);
      const items = req.body?.credentials;
      const { fieldsList, hashes, tree } = validateBatch(items, inst, false);
      for (const [i, f] of fieldsList.entries()) {
        await assertEmailFree(validateStudentEmail(items[i]?.studentEmail), f.studentId);
        if (await store.get(f.credentialId)) throw new HttpError(409, `Credential ID "${f.credentialId}" already exists.`);
      }
      res.json({
        root: tree.root,
        count: fieldsList.length,
        credentials: fieldsList.map((f, i) => ({ ...f, studentEmail: items[i]?.studentEmail ?? null, docHash: hashes[i] })),
      });
    })
  );

  // Merkle batch, step 2: record it once the contract holds this root under this university.
  app.post(
    '/api/credentials/batch',
    ...issuer,
    writeLimit,
    express.json({ limit: '1mb' }),
    asyncRoute(async (req, res) => {
      const inst = await actingInstitution(req);
      const items = req.body?.credentials;
      const { fieldsList, hashes, tree } = validateBatch(items, inst, true);
      const emails = items.map((item) => validateStudentEmail(item?.studentEmail));
      for (const [i, f] of fieldsList.entries()) {
        await assertEmailFree(emails[i], f.studentId);
        if (await store.get(f.credentialId)) throw new HttpError(409, `Credential ID "${f.credentialId}" already exists.`);
      }
      const batchId = Number(req.body?.batchId);
      if (!Number.isInteger(batchId) || batchId < 1) throw new HttpError(400, 'batchId is required.');
      const onChain = await chain.batchInfo(batchId);
      if (!onChain) throw new HttpError(409, 'The smart contract has no such batch yet.', { code: 'not_on_chain' });
      if (onChain.root !== tree.root.toLowerCase() || onChain.count !== fieldsList.length) {
        throw new HttpError(409, 'The Merkle root in the smart contract does not match these credentials.', { code: 'hash_mismatch' });
      }
      if (!sameAddress(onChain.issuer, inst.walletAddress)) {
        throw new HttpError(403, "This batch was signed by another wallet, not your institution's.", { code: 'wrong_issuer' });
      }
      const tx = await confirmedTransaction(req.body?.txHash);
      const contract = await chain.address();
      const records = await store.insertMany(
        fieldsList.map((f, i) => ({
          ...f,
          txHash: tx?.txHash ?? hashes[i],
          hash: hashes[i],
          status: 'valid',
          revocation: null,
          institutionId: inst.id,
          issuerAddress: inst.walletAddress,
          batch: { batchId, root: tree.root, proof: tree.proof(i), index: i },
          chain: { mode: 'batch', network: network.name, contract, txHash: tx?.txHash ?? null, blockNumber: tx?.blockNumber ?? null },
        }))
      );
      for (const [i, f] of fieldsList.entries()) await recordStudent(f, emails[i], inst);
      await audit(req, 'batch_anchored', `batch:${batchId}`, { institution: inst.id, count: records.length, root: tree.root, txHash: tx?.txHash ?? null });
      res.status(201).json({
        batchId,
        root: tree.root,
        txHash: tx?.txHash ?? null,
        count: records.length,
        credentials: records.map((r) => ({ credentialId: r.credentialId, hash: r.hash })),
      });
    })
  );

  // Each university sees only its own credentials.
  app.get(
    '/api/credentials',
    ...issuer,
    asyncRoute(async (req, res) => {
      const inst = await actingInstitution(req);
      res.json(await store.listByInstitution(inst.id));
    })
  );

  // Revocation: the university signs revokeCredential (or revokeBatchCredential)
  // in MetaMask; this records it once the contract shows it, with the same reason.
  app.post(
    '/api/credentials/:id/revoke',
    ...issuer,
    writeLimit,
    express.json({ limit: '10kb' }),
    asyncRoute(async (req, res) => {
      const record = await store.get(req.params.id);
      if (!record) throw new HttpError(404, 'Credential not found.');
      const inst = await actingInstitution(req);
      if (!mayManage(record, inst)) throw new HttpError(403, 'Only the institution that issued this credential can revoke it.');
      if (record.status === 'revoked') throw new HttpError(409, 'Credential is already revoked.');
      const reason = normalizeReason(req.body?.reason);
      const onChain = await onChainFor(record);
      if (onChain?.status !== 'revoked') {
        throw new HttpError(409, 'The smart contract does not show this credential as revoked yet. Sign the revocation in MetaMask first.', {
          code: 'not_revoked_on_chain',
        });
      }
      const event = (await chain.history(record.credentialId, record.batch?.batchId)).findLast((e) => e.type === 'revoked');
      if (!event || event.reasonHash.toLowerCase() !== keccak256(toUtf8Bytes(reason)).toLowerCase()) {
        throw new HttpError(409, 'The reason does not match the one signed in the smart contract.', { code: 'reason_mismatch' });
      }
      const updated = await store.update(record.credentialId, {
        status: 'revoked',
        revocation: { reason, date: today(), txHash: event.txHash, blockNumber: event.blockNumber },
      });
      await audit(req, 'credential_revoked', record.credentialId, { txHash: event.txHash });
      res.json(updated);
    })
  );

  app.get(
    '/api/credentials/:id/certificate',
    ...issuer,
    asyncRoute(async (req, res) => {
      const record = await store.get(req.params.id);
      if (!record) throw new HttpError(404, 'Credential not found.');
      const inst = await actingInstitution(req);
      if (!mayManage(record, inst)) throw new HttpError(403, 'This credential belongs to another institution.');
      const degree = await store.findDegreeRecord(record.certificateNo ?? record.credentialId);
      res.json(await printableCard(degree, degree ? null : record));
    })
  );

  app.get(
    '/api/credentials/:id',
    asyncRoute(async (req, res) => {
      const record = await store.get(req.params.id);
      if (!record) return res.status(404).json({ error: 'Credential not found.' });
      const { ipfs: _secret, ...rest } = record; // the document key belongs to the student
      res.json(rest);
    })
  );

  // ---- routes: platform admin ------------------------------------------------

  app.get(
    '/api/admin/institutions',
    ...admin,
    asyncRoute(async (_req, res) => {
      const counts = await store.countCredentialsByInstitution();
      res.json((await store.listInstitutions()).map((i) => ({ ...institutions.publicView(i), credentialCount: counts[i.id] ?? 0 })));
    })
  );

  // approve / suspend confirm a setIssuer transaction the admin signed in MetaMask.
  for (const action of ['approve', 'reject', 'suspend']) {
    app.post(
      `/api/admin/institutions/:id/${action}`,
      ...admin,
      writeLimit,
      asyncRoute(async (req, res) => {
        let result;
        try {
          result = await institutions[action](req.params.id, req.user.sub);
        } catch (err) {
          if (err.status) throw new HttpError(err.status, err.message, err.code ? { code: err.code } : {});
          throw err;
        }
        await audit(req, `institution_${action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'suspended'}`, req.params.id, {
          wallet: result.walletAddress ?? null,
        });
        res.json(institutions.publicView(result));
      })
    );
  }

  app.get(
    '/api/admin/audit',
    ...admin,
    asyncRoute(async (req, res) => {
      const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 1000);
      res.json(await store.listAudit(limit));
    })
  );

  app.get(
    '/api/admin/registry',
    ...admin,
    asyncRoute(async (_req, res) => {
      const [contract, owner, paused, stats] = await Promise.all([chain.address(), chain.owner(), chain.paused(), chain.stats()]);
      res.json({ network: network.name, chainId: network.chainId, contract, owner, paused, ...stats });
    })
  );

  // Emergency stop: the admin signs pause()/unpause() in MetaMask; this records
  // what the contract now says. Verification keeps working while paused.
  app.post(
    '/api/admin/pause',
    ...admin,
    express.json({ limit: '1kb' }),
    asyncRoute(async (req, res) => {
      const paused = await chain.paused();
      if (req.body?.paused !== undefined && Boolean(req.body.paused) !== paused) {
        throw new HttpError(409, `The smart contract is ${paused ? 'paused' : 'not paused'}. Sign the change in MetaMask first.`, { code: 'not_on_chain' });
      }
      await audit(req, paused ? 'registry_paused' : 'registry_unpaused', null, null);
      res.json({ paused });
    })
  );

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found.' }));

  // ---- errors ---------------------------------------------------------------

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof ChainUnavailableError) {
      return res.status(503).json({
        status: 'unavailable',
        code: 'chain_unavailable',
        error: 'The Ethereum network is unavailable. Verification cannot be completed right now.',
      });
    }
    if (err instanceof ContractRevertError) {
      return res.status(REVERT_STATUS[err.reason] ?? 400).json({ error: err.message, code: err.reason });
    }
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, ...err.extra });
    // A unique-key clash in the database: a double submission lost the race.
    if (err?.code === '23505') return res.status(409).json({ error: 'This record already exists.' });
    if (err?.type === 'entity.too.large') return res.status(413).json({ status: 'rejected', code: 'invalid_file', error: 'Request body too large.' });
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Malformed JSON body.' });
    console.error(err);
    return res.status(500).json({ error: 'Internal server error.' });
  });

  return app;
}
