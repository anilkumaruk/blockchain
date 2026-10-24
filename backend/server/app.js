// REST API for Chain of Record. Response shapes intentionally mirror the
// frontend's src/lib/mockApi.js so the React app can switch between the mock
// and this backend without changing any page code.

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { buildCertificateBytes, computeSha256Hex } from '../../src/lib/generateCertificatePdf.js';
import { ChainUnavailableError, ContractRevertError } from './chain.js';
import { buildMerkleTree, leafOf } from './merkle.js';
import { createInstitutionService } from './institutions.js';
import { hashPassword } from './passwords.js';

const ID_PATTERN = /^[A-Za-z0-9-]{4,40}$/;
const CERT_REF_PATTERN = /^0x[0-9a-f]{64}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const HASH_PATTERN = /^(0x)?[0-9a-f]{64}$/i;
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
 *   chain: ReturnType<import('./chain.js').createChainBridge>,
 *   store: ReturnType<import('./store.js').createMemoryStore>,
 *   auth: ReturnType<import('./auth.js').createAuth>,
 *   institutionName: string,          // the platform owner (root institution)
 *   trustedIssuer?: string,
 *   connect: (privateKey: string) => ReturnType<import('./chain.js').createChainBridge>,
 *   walletKey: Buffer,                // encrypts institution wallet keys
 *   fundingWei?: bigint,              // gas money sent to newly approved institutions
 *   corsOrigin?: string | string[] | boolean,
 *   rateLimits?: boolean,
 *   trustProxy?: boolean | number | string,
 * }} deps
 */
export function createApp({
  chain,
  store,
  auth,
  institutionName,
  trustedIssuer,
  connect,
  walletKey,
  fundingWei = 10n ** 18n,
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

  // Institutions the platform vouches for: the contract owner (root) plus every
  // approved institution, each signing with its own on-chain issuer wallet.
  const institutions = createInstitutionService({
    chain,
    connect,
    store,
    walletKey,
    fundingWei,
    rootName: institutionName,
    trustedIssuer,
  });
  const actingInstitution = async (req) => {
    try {
      return await institutions.forUser(req.user);
    } catch (err) {
      throw new HttpError(err.status ?? 403, err.message);
    }
  };
  // Records issued before multi-institution support belong to the root.
  const institutionOf = async (record) =>
    record.institutionId ? store.getInstitution(record.institutionId) : institutions.root();
  const mayManage = (req, record, actor) =>
    req.user.role === 'admin' ? !record.institutionId || record.institutionId === actor.id : record.institutionId === actor.id;

  // ---- issuance helpers ----------------------------------------------------

  function validateIssueInput(body, issuerName) {
    const fields = {
      studentName: String(body.studentName ?? '').trim(),
      studentId: String(body.studentId ?? '').trim(),
      credentialType: String(body.credentialType ?? '').trim(),
      issueDate: body.issueDate ? String(body.issueDate) : today(),
      credentialId: body.credentialId
        ? String(body.credentialId).trim()
        : `COR-${new Date().getFullYear()}-${randomHex(3).toUpperCase()}`,
      txHash: body.txHash ? String(body.txHash) : '0x' + randomHex(32),
      issuer: issuerName,
    };
    const missing = ['studentName', 'studentId', 'credentialType'].filter((k) => !fields[k]);
    if (missing.length) throw new HttpError(400, `Missing required field(s): ${missing.join(', ')}.`);
    if (['studentName', 'studentId', 'credentialType'].some((k) => fields[k].length > MAX_TEXT)) {
      throw new HttpError(400, `Fields must be at most ${MAX_TEXT} characters.`);
    }
    if (!ID_PATTERN.test(fields.credentialId)) throw new HttpError(400, 'Invalid credential ID format.');
    if (!CERT_REF_PATTERN.test(fields.txHash)) throw new HttpError(400, 'Invalid certificate reference.');
    if (!DATE_PATTERN.test(fields.issueDate) || Number.isNaN(Date.parse(fields.issueDate))) {
      throw new HttpError(400, 'issueDate must be a valid YYYY-MM-DD date.');
    }
    return fields;
  }

  function validateStudentEmail(value) {
    if (value == null || value === '') return null;
    const email = String(value).trim().toLowerCase();
    if (!EMAIL_PATTERN.test(email)) throw new HttpError(400, 'studentEmail is not a valid email address.');
    return email;
  }

  // Checked before anything is written, so a clash never leaves a credential
  // anchored on-chain with a failed request.
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
      await store.upsertStudent({
        studentId: fields.studentId,
        fullName: fields.studentName,
        email,
        institutionId: institution.id,
      });
    } catch (err) {
      if (err.code === '23505') throw new HttpError(409, 'That student email already belongs to another student.');
      throw err;
    }
  }

  async function issue(fields, institution, extra = {}) {
    if (await store.get(fields.credentialId)) {
      throw new HttpError(409, `Credential ID "${fields.credentialId}" already exists.`);
    }
    // The backend, not the client, computes the fingerprint that goes on-chain.
    const hash = await computeSha256Hex(buildCertificateBytes(fields));
    const bridge = await institutions.bridgeFor(institution);
    const receipt = await bridge.issue(fields.credentialId, hash);
    const record = await store.insert({
      ...fields,
      ...extra,
      institutionId: institution.id,
      issuerAddress: institution.walletAddress,
      hash,
      status: 'valid',
      revocation: null,
      chain: {
        mode: 'individual',
        txHash: receipt.txHash,
        blockNumber: receipt.blockNumber,
        gasUsed: String(receipt.gasUsed),
        contract: await chain.address(),
      },
    });
    return { credentialId: record.credentialId, hash, txHash: record.txHash, qrPayload: record.credentialId, record };
  }

  async function revoke(req, credentialId, reasonInput) {
    const record = await store.get(credentialId);
    if (!record) throw new HttpError(404, 'Credential not found.');
    const actor = await actingInstitution(req);
    if (!mayManage(req, record, actor)) {
      throw new HttpError(403, 'Only the institution that issued this credential can revoke it.');
    }
    if (record.status === 'revoked') throw new HttpError(409, 'Credential is already revoked.');
    const reason = String(reasonInput ?? '').trim().slice(0, 500) || 'No reason provided.';
    const bridge = await institutions.bridgeFor(await institutionOf(record));
    const receipt = record.batch
      ? await bridge.revokeBatch({ ...record.batch, credentialId, hash: record.hash }, reason)
      : await bridge.revoke(credentialId, reason);
    return store.update(credentialId, {
      status: 'revoked',
      revocation: {
        reason,
        date: today(),
        txHash: receipt.txHash,
        blockNumber: receipt.blockNumber,
        gasUsed: String(receipt.gasUsed),
      },
    });
  }

  // ---- verification --------------------------------------------------------

  // The chain is the source of truth for hash + status; the off-chain record
  // only supplies human-readable details, and is itself cross-checked.
  async function evaluate(onChain, record, query) {
    const trusted = onChain.issuerActive ? await institutions.trustedByAddress(onChain.issuer) : null;
    if (!trusted) {
      return {
        status: 'invalid',
        code: 'untrusted_issuer',
        details: {
          reason: 'This credential was not issued by an institution approved on this platform.',
          issuer: onChain.issuer,
          ...query,
        },
      };
    }
    if (record && record.hash !== onChain.hash) return recordMismatch(query);
    const details = {
      ...(record ?? { credentialId: query.submittedId ?? null, issuer: trusted.name }),
      issuerInstitution: { id: trusted.id, name: trusted.name, address: onChain.issuer },
      hash: onChain.hash,
      status: onChain.status,
      onChain,
    };
    return { status: onChain.status === 'revoked' ? 'revoked' : 'valid', code: onChain.status, details };
  }

  const recordMismatch = (query) => ({
    status: 'invalid',
    code: 'record_mismatch',
    details: {
      reason: 'The institution record does not match the fingerprint anchored on-chain.',
      ...query,
    },
  });

  // Batch credentials aren't indexed on-chain individually; the off-chain
  // record supplies the Merkle proof and the contract checks it.
  async function verifyBatchRecord(record, query) {
    const onChain = await chain.verifyBatch({ ...record.batch, credentialId: record.credentialId, hash: record.hash });
    return onChain ? evaluate(onChain, record, query) : recordMismatch(query);
  }

  // Accepts our credential ID or the number printed on the certificate
  // (e.g. "VTU/DC/2023/000005").
  async function verifyById(submitted) {
    const record = (await store.get(submitted)) ?? (await store.findByCertificateNo(submitted));
    const credentialId = record?.credentialId ?? submitted;
    const onChain = await chain.getById(credentialId);
    const query = { submittedId: submitted };
    if (onChain) return evaluate(onChain, record, query);
    if (record?.batch) return verifyBatchRecord(record, query);
    return {
      status: 'invalid',
      code: 'not_found',
      details: {
        reason: `No credential found on-chain matching ID "${submitted}".`,
        submittedId: submitted,
        submittedHash: null,
      },
    };
  }

  async function verifyByHash(hashInput) {
    const hash = '0x' + String(hashInput).toLowerCase().replace(/^0x/, '');
    const onChain = await chain.getByHash(hash);
    const query = { submittedHash: hash };
    if (onChain) return evaluate(onChain, await store.findByHash(hash), query);
    const record = await store.findByHash(hash);
    if (record?.batch) return verifyBatchRecord(record, query);
    return {
      status: 'invalid',
      code: 'hash_mismatch',
      details: {
        reason:
          'The computed document hash does not match any record on-chain. The file may have been altered, or was never issued through this system.',
        submittedId: null,
        submittedHash: hash,
      },
    };
  }

  // ---- routes: public --------------------------------------------------------

  app.get(
    '/api/health',
    asyncRoute(async (_req, res) => {
      let contract = null;
      let paused = null;
      try {
        contract = await chain.address();
        paused = await chain.paused();
      } catch {
        return res.status(503).json({ ok: false, chain: 'unavailable', store: store.kind });
      }
      res.json({ ok: true, chain: 'reachable', contract, paused, store: store.kind });
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
          return res
            .status(423)
            .json({ error: 'Account temporarily locked after repeated failed sign-ins.', code: 'locked' });
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
        throw new HttpError(
          404,
          'No student record uses this email. Ask your institution to add your personal email to your record.',
          { code: 'no_student_record' }
        );
      }
      let passwordHash;
      try {
        passwordHash = await hashPassword(String(req.body?.password ?? ''));
      } catch (err) {
        throw new HttpError(400, err.message);
      }
      try {
        await store.createUser({
          username: email,
          email,
          passwordHash,
          role: 'student',
          studentId: student.studentId,
          institutionId: student.institutionId,
        });
      } catch (err) {
        if (err.code === '23505') throw new HttpError(409, 'An account already exists for this email. Sign in instead.');
        throw err;
      }
      await store.addAudit({ actor: email, action: 'student_registered', target: student.studentId, ip: req.ip });
      res.status(201).json({ ok: true, studentId: student.studentId, fullName: student.fullName });
    })
  );

  // Any institution can apply; it can issue only after the platform admin
  // approves it (which creates and authorizes its on-chain wallet).
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
      if (website && !/^https?:\/\/[^\s]+\.[^\s]+$/i.test(website)) {
        throw new HttpError(400, 'Website must start with http:// or https://.');
      }
      let passwordHash;
      try {
        passwordHash = await hashPassword(String(b.password ?? ''));
      } catch (err) {
        throw new HttpError(400, err.message);
      }
      if (await store.findUserForLogin(email)) throw new HttpError(409, 'An account already exists for this email.');
      let inst;
      try {
        inst = await institutions.register({ name, kind, email, website });
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
      await institutions.root();
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
        institution: inst ? { id: inst.id, name: inst.name, status: inst.status } : null,
      });
    })
  );

  app.get(
    '/api/me/credentials',
    ...auth.requireRole('student'),
    asyncRoute(async (req, res) => res.json(await store.listByStudent(req.user.studentId)))
  );

  // Public read for the student portal and shared public profile pages.
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
      if (!HASH_PATTERN.test(String(req.body?.hash ?? ''))) {
        throw new HttpError(400, 'hash must be a 32-byte hex SHA-256 digest.');
      }
      res.json(await verifyByHash(req.body.hash));
    })
  );

  // Raw certificate upload. The server recomputes SHA-256 itself, so a
  // verifier does not have to trust a client-side hash.
  app.post(
    '/api/verify/file',
    verifyLimit,
    express.raw({ type: () => true, limit: '5mb' }),
    asyncRoute(async (req, res) => {
      const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      if (bytes.length < 5 || bytes.subarray(0, 5).toString('latin1') !== '%PDF-') {
        throw new HttpError(415, 'File rejected: only PDF certificates can be verified.', {
          status: 'rejected',
          code: 'invalid_file',
        });
      }
      res.json(await verifyByHash(await computeSha256Hex(bytes)));
    })
  );

  // ---- routes: admin ----------------------------------------------------------

  const admin = auth.requireRole('admin');
  // Registrars of the platform owner ('admin') and of approved institutions.
  const issuer = auth.requireRole('admin', 'institution');

  app.post(
    '/api/credentials',
    ...issuer,
    writeLimit,
    express.json({ limit: '20kb' }),
    asyncRoute(async (req, res) => {
      const inst = await actingInstitution(req);
      const fields = validateIssueInput(req.body ?? {}, inst.name);
      const email = validateStudentEmail(req.body?.studentEmail);
      await assertEmailFree(email, fields.studentId);
      const issued = await issue(fields, inst);
      await recordStudent(fields, email, inst);
      await audit(req, 'credential_issued', issued.credentialId, {
        txHash: issued.record.chain.txHash,
        institution: inst.id,
      });
      res.status(201).json(issued);
    })
  );

  // Merkle batch issuance: many credentials, one transaction, one root.
  app.post(
    '/api/credentials/batch',
    ...issuer,
    writeLimit,
    express.json({ limit: '1mb' }),
    asyncRoute(async (req, res) => {
      const items = req.body?.credentials;
      if (!Array.isArray(items) || items.length === 0) {
        throw new HttpError(400, 'credentials must be a non-empty array.');
      }
      if (items.length > MAX_BATCH) throw new HttpError(400, `A batch can hold at most ${MAX_BATCH} credentials.`);
      const inst = await actingInstitution(req);

      const fieldsList = items.map((item, i) => {
        try {
          return validateIssueInput(item ?? {}, inst.name);
        } catch (err) {
          throw new HttpError(400, `Item ${i}: ${err.message}`);
        }
      });
      const emails = items.map((item) => validateStudentEmail(item?.studentEmail));
      for (const [i, f] of fieldsList.entries()) await assertEmailFree(emails[i], f.studentId);
      const ids = new Set();
      for (const f of fieldsList) {
        if (ids.has(f.credentialId)) throw new HttpError(409, `Duplicate credential ID "${f.credentialId}" in batch.`);
        ids.add(f.credentialId);
        if (await store.get(f.credentialId)) {
          throw new HttpError(409, `Credential ID "${f.credentialId}" already exists.`);
        }
      }

      const hashes = await Promise.all(fieldsList.map((f) => computeSha256Hex(buildCertificateBytes(f))));
      const tree = buildMerkleTree(fieldsList.map((f, i) => leafOf(f.credentialId, hashes[i])));
      const receipt = await (await institutions.bridgeFor(inst)).anchorBatch(tree.root, fieldsList.length);
      const contract = await chain.address();

      const records = await store.insertMany(
        fieldsList.map((f, i) => ({
          ...f,
          institutionId: inst.id,
          issuerAddress: inst.walletAddress,
          hash: hashes[i],
          status: 'valid',
          revocation: null,
          batch: { batchId: receipt.batchId, root: tree.root, proof: tree.proof(i), index: i },
          chain: {
            mode: 'batch',
            txHash: receipt.txHash,
            blockNumber: receipt.blockNumber,
            gasUsed: String(receipt.gasUsed),
            contract,
          },
        }))
      );
      for (const [i, f] of fieldsList.entries()) {
        await recordStudent(f, emails[i], inst);
      }
      await audit(req, 'batch_anchored', `batch:${receipt.batchId}`, {
        institution: inst.id,
        count: records.length,
        root: tree.root,
        txHash: receipt.txHash,
      });
      res.status(201).json({
        batchId: receipt.batchId,
        root: tree.root,
        txHash: receipt.txHash,
        gasUsed: String(receipt.gasUsed),
        count: records.length,
        credentials: records.map((r) => ({ credentialId: r.credentialId, hash: r.hash })),
      });
    })
  );

  // The platform admin sees every credential; an institution sees its own.
  app.get(
    '/api/credentials',
    ...issuer,
    asyncRoute(async (req, res) => {
      if (req.user.role === 'admin') return res.json(await store.listAll());
      const inst = await actingInstitution(req);
      res.json(await store.listByInstitution(inst.id));
    })
  );

  app.post(
    '/api/credentials/:id/revoke',
    ...issuer,
    writeLimit,
    express.json({ limit: '10kb' }),
    asyncRoute(async (req, res) => {
      const updated = await revoke(req, req.params.id, req.body?.reason);
      await audit(req, 'credential_revoked', req.params.id, { txHash: updated.revocation.txHash });
      res.json(updated);
    })
  );

  // Correction flow: the old credential is revoked (never deleted) and a new
  // one is issued with the corrected fields, the two linked both ways.
  app.post(
    '/api/credentials/:id/reissue',
    ...issuer,
    writeLimit,
    express.json({ limit: '20kb' }),
    asyncRoute(async (req, res) => {
      const old = await store.get(req.params.id);
      if (!old) throw new HttpError(404, 'Credential not found.');
      const inst = await actingInstitution(req);
      if (!mayManage(req, old, inst)) {
        throw new HttpError(403, 'Only the institution that issued this credential can correct it.');
      }
      const body = req.body ?? {};
      const fields = validateIssueInput(
        {
          studentName: body.studentName ?? old.studentName,
          studentId: body.studentId ?? old.studentId,
          credentialType: body.credentialType ?? old.credentialType,
          issueDate: body.issueDate ?? today(),
          credentialId: body.credentialId,
        },
        inst.name
      );
      if (old.status !== 'revoked') {
        await revoke(req, old.credentialId, body.reason || 'Superseded by a corrected credential.');
      }
      const issued = await issue(fields, inst, { replaces: old.credentialId });
      await store.update(old.credentialId, { replacedBy: issued.credentialId });
      await audit(req, 'credential_reissued', old.credentialId, { replacedBy: issued.credentialId });
      res.status(201).json(issued);
    })
  );

  app.get(
    '/api/credentials/:id',
    asyncRoute(async (req, res) => {
      const record = await store.get(req.params.id);
      if (!record) return res.status(404).json({ error: 'Credential not found.' });
      res.json(record);
    })
  );

  app.get(
    '/api/admin/institutions',
    ...admin,
    asyncRoute(async (_req, res) => {
      await institutions.root();
      res.json((await store.listInstitutions()).map(institutions.publicView));
    })
  );

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
          if (err.status) throw new HttpError(err.status, err.message);
          throw err;
        }
        await audit(req, `institution_${action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'suspended'}`, req.params.id, {
          wallet: result.walletAddress ?? null,
          setIssuerTx: result.setIssuerTx ?? null,
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
      const [contract, owner, paused] = await Promise.all([chain.address(), chain.owner(), chain.paused()]);
      res.json({ contract, owner, trustedIssuer: (await institutions.root()).walletAddress, paused });
    })
  );

  // Emergency stop (e.g. suspected key compromise). Verification keeps working.
  app.post(
    '/api/admin/pause',
    ...admin,
    express.json({ limit: '1kb' }),
    asyncRoute(async (req, res) => {
      const paused = Boolean(req.body?.paused);
      const receipt = await chain.setPaused(paused);
      await audit(req, paused ? 'registry_paused' : 'registry_unpaused', null, { txHash: receipt.txHash });
      res.json({ paused, txHash: receipt.txHash });
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
        error: 'Blockchain network is unavailable. Verification cannot be completed right now.',
      });
    }
    if (err instanceof ContractRevertError) {
      const message =
        err.reason === 'EnforcedPause'
          ? 'The registry is paused by the institution. Issuance and revocation are temporarily disabled.'
          : err.message;
      return res.status(REVERT_STATUS[err.reason] ?? 400).json({ error: message, code: err.reason });
    }
    if (err instanceof HttpError) {
      return res.status(err.status).json({ error: err.message, ...err.extra });
    }
    if (err?.type === 'entity.too.large') {
      return res.status(413).json({ status: 'rejected', code: 'invalid_file', error: 'Request body too large.' });
    }
    if (err?.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'Malformed JSON body.' });
    }
    console.error(err);
    return res.status(500).json({ error: 'Internal server error.' });
  });

  return app;
}
