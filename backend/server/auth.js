// JWT authentication + role-based access control (RBAC).
// Roles: 'admin' (registrar, may issue/revoke) and 'student' (read own
// credentials). Verification endpoints are public and need no token.
//
// Accounts live in the store (PostgreSQL `users` table) with scrypt password
// hashes. Repeated failures lock the account for a while.

import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { DUMMY_HASH, verifyPassword } from './passwords.js';

const JWT_OPTIONS = { algorithm: 'HS256', issuer: 'chain-of-record', audience: 'chain-of-record-api' };

/**
 * @param {{
 *   jwtSecret: string,
 *   store: ReturnType<import('./store.js').createMemoryStore>,
 *   tokenTtl?: string,
 *   maxAttempts?: number,
 *   lockMs?: number,
 * }} opts
 */
export function createAuth({ jwtSecret, store, tokenTtl = '1h', maxAttempts = 5, lockMs = 15 * 60 * 1000 }) {
  if (!jwtSecret) throw new Error('JWT secret is required');

  /**
   * @param {string} login username or email
   * @returns {Promise<{ ok: true, session: object } | { ok: false, reason: 'invalid' | 'locked' | 'pending' | 'suspended' }>}
   */
  async function login(loginName, password) {
    const name = String(loginName ?? '').trim();
    const account = name ? await store.findUserForLogin(name) : null;

    if (account?.lockedUntil && new Date(account.lockedUntil) > new Date()) {
      return { ok: false, reason: 'locked' };
    }
    // Always run scrypt so response time doesn't reveal which usernames exist.
    const valid = await verifyPassword(password, account?.passwordHash ?? DUMMY_HASH);
    if (!account || !valid) {
      if (account) await store.recordLoginFailure(account.username, { maxAttempts, lockMs });
      return { ok: false, reason: 'invalid' };
    }

    await store.resetLoginFailures(account.username);

    // Institution accounts work only once the platform admin has approved them.
    let institution = null;
    if (account.institutionId) {
      institution = await store.getInstitution(account.institutionId);
      if (account.role === 'institution' && institution?.status !== 'approved') {
        return { ok: false, reason: institution?.status === 'suspended' ? 'suspended' : 'pending' };
      }
    }
    const claims = {
      role: account.role,
      studentId: account.studentId ?? undefined,
      institutionId: account.institutionId ?? undefined,
    };
    const token = jwt.sign(claims, jwtSecret, {
      ...JWT_OPTIONS,
      subject: account.username,
      expiresIn: tokenTtl,
      jwtid: crypto.randomUUID(),
    });
    return {
      ok: true,
      session: {
        token,
        sub: account.username,
        email: account.email ?? undefined,
        ...claims,
        institution: institution ? { id: institution.id, name: institution.name } : undefined,
      },
    };
  }

  function authenticate(req, res, next) {
    const header = req.get('authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Authentication required.' });
    try {
      req.user = jwt.verify(token, jwtSecret, {
        algorithms: [JWT_OPTIONS.algorithm],
        issuer: JWT_OPTIONS.issuer,
        audience: JWT_OPTIONS.audience,
      });
      return next();
    } catch {
      return res.status(401).json({ error: 'Invalid or expired token.' });
    }
  }

  const requireRole = (...roles) => [
    authenticate,
    (req, res, next) =>
      roles.includes(req.user.role)
        ? next()
        : res.status(403).json({ error: 'Access denied: insufficient role.' }),
  ];

  return { login, authenticate, requireRole };
}
