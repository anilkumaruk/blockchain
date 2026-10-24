// Off-chain academic data layer. Full student/credential details, user
// accounts and the audit log live here, never on-chain.
// PostgreSQL is the real store; the in-memory store exists so the test suite
// and benchmark run without a database. Both expose the same async interface.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

// Return DATE columns as plain 'YYYY-MM-DD' strings — the certificate bytes
// (and so the on-chain hash) depend on the exact issueDate text.
pg.types.setTypeParser(1082, (v) => v);

const COLUMNS = {
  credentialId: 'credential_id',
  studentName: 'student_name',
  studentId: 'student_id',
  credentialType: 'credential_type',
  issueDate: 'issue_date',
  issuer: 'issuer',
  txHash: 'cert_ref',
  hash: 'doc_hash',
  status: 'status',
  revocation: 'revocation',
  chain: 'chain',
  batch: 'batch',
  replaces: 'replaces',
  replacedBy: 'replaced_by',
  institutionId: 'institution_id',
  issuerAddress: 'issuer_address',
  certificateNo: 'certificate_no',
};

const INSTITUTION_COLUMNS = {
  id: 'id',
  name: 'name',
  kind: 'kind',
  email: 'email',
  website: 'website',
  status: 'status',
  walletAddress: 'wallet_address',
  walletKeyEnc: 'wallet_key_enc',
  source: 'source',
  createdAt: 'created_at',
  approvedAt: 'approved_at',
  approvedBy: 'approved_by',
  sourceRef: 'source_ref',
  shortCode: 'short_code',
  univType: 'univ_type',
  regulator: 'regulator',
  city: 'city',
  state: 'state',
  pincode: 'pincode',
  establishedYear: 'established_year',
  gradingSystem: 'grading_system',
  aisheCode: 'aishe_code',
  ugcRecognised: 'ugc_recognised',
};

const lower = (v) => (v == null ? null : String(v).trim().toLowerCase());

export function createMemoryStore() {
  const rows = new Map();
  const users = new Map();
  const institutions = new Map();
  const students = new Map();
  const audit = [];
  const copy = (r) => (r ? structuredClone(r) : null);

  return {
    kind: 'memory',
    async insert(record) {
      if (rows.has(record.credentialId)) throw new Error('duplicate credential_id');
      rows.set(record.credentialId, copy(record));
      return copy(record);
    },
    async insertMany(records) {
      for (const r of records) if (rows.has(r.credentialId)) throw new Error('duplicate credential_id');
      for (const r of records) rows.set(r.credentialId, copy(r));
      return records.map(copy);
    },
    async update(credentialId, patch) {
      const current = rows.get(credentialId);
      if (!current) return null;
      const next = { ...current, ...patch };
      rows.set(credentialId, next);
      return copy(next);
    },
    async get(credentialId) {
      return copy(rows.get(credentialId));
    },
    async findByHash(hash) {
      for (const r of rows.values()) if (r.hash === hash) return copy(r);
      return null;
    },
    async findByCertificateNo(no) {
      for (const r of rows.values()) if (r.certificateNo && r.certificateNo === no) return copy(r);
      return null;
    },
    async listByStudent(studentId) {
      return [...rows.values()].filter((r) => r.studentId === studentId).reverse().map(copy);
    },
    async listAll() {
      return [...rows.values()].reverse().map(copy);
    },
    async listByInstitution(institutionId) {
      return [...rows.values()].filter((r) => r.institutionId === institutionId).reverse().map(copy);
    },

    async getUser(username) {
      return copy(users.get(username));
    },
    async findUserForLogin(login) {
      const l = lower(login);
      return copy(users.get(login) ?? [...users.values()].find((u) => u.email && u.email === l));
    },
    async createUser({ username, passwordHash, role, studentId = null, email = null, institutionId = null }) {
      const e = lower(email);
      if (users.has(username) || (e && [...users.values()].some((u) => u.email === e))) {
        throw Object.assign(new Error('duplicate user'), { code: '23505' });
      }
      users.set(username, {
        username, passwordHash, role, studentId, email: e, institutionId, failedAttempts: 0, lockedUntil: null,
      });
    },
    async updateUser(username, patch) {
      const u = users.get(username);
      if (u) Object.assign(u, patch);
    },

    async getInstitution(id) {
      return copy(institutions.get(id));
    },
    async findInstitutionByAddress(address) {
      const a = lower(address);
      return copy([...institutions.values()].find((i) => lower(i.walletAddress) === a));
    },
    async findInstitutionByName(name) {
      const n = lower(name);
      return copy([...institutions.values()].find((i) => lower(i.name) === n));
    },
    async listInstitutions() {
      return [...institutions.values()].map(copy);
    },
    async createInstitution(inst) {
      if (institutions.has(inst.id) || [...institutions.values()].some((i) => lower(i.name) === lower(inst.name))) {
        throw Object.assign(new Error('duplicate institution'), { code: '23505' });
      }
      const row = { kind: 'university', status: 'pending', source: 'registration', walletAddress: null,
        walletKeyEnc: null, approvedAt: null, approvedBy: null, createdAt: new Date().toISOString(), ...inst };
      institutions.set(inst.id, row);
      return copy(row);
    },
    async updateInstitution(id, patch) {
      const i = institutions.get(id);
      if (!i) return null;
      Object.assign(i, patch);
      return copy(i);
    },

    async getStudent(studentId) {
      return copy(students.get(studentId));
    },
    async findStudentByEmail(email) {
      const e = lower(email);
      return copy([...students.values()].find((s) => s.email === e));
    },
    async upsertStudent({ studentId, fullName, email = null, institutionId = null, source = 'issuance' }) {
      const e = lower(email);
      const clash = e && [...students.values()].find((s) => s.email === e && s.studentId !== studentId);
      if (clash) throw Object.assign(new Error('email already used by another student'), { code: '23505' });
      const cur = students.get(studentId);
      const row = cur
        ? { ...cur, fullName, email: e ?? cur.email, institutionId: cur.institutionId ?? institutionId }
        : { studentId, fullName, email: e, institutionId, source };
      students.set(studentId, row);
      return copy(row);
    },
    async countUsers() {
      return users.size;
    },
    async recordLoginFailure(username, { maxAttempts, lockMs }) {
      const u = users.get(username);
      if (!u) return;
      u.failedAttempts += 1;
      if (u.failedAttempts >= maxAttempts) {
        u.lockedUntil = new Date(Date.now() + lockMs).toISOString();
        u.failedAttempts = 0;
      }
    },
    async resetLoginFailures(username) {
      const u = users.get(username);
      if (u) Object.assign(u, { failedAttempts: 0, lockedUntil: null });
    },

    async addAudit(entry) {
      audit.push({ id: audit.length + 1, at: new Date().toISOString(), ...copy(entry) });
    },
    async listAudit(limit = 100) {
      return audit.slice(-limit).reverse().map(copy);
    },
  };
}

async function migrate(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  const applied = new Set((await pool.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    if (applied.has(file)) continue;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8'));
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log(`  migration applied: ${file}`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}

const CONNECTION_ERROR_CODES = new Set(['ECONNRESET', 'EPIPE', 'ETIMEDOUT', '57P01', '57P02', '57P03', '08003', '08006']);
const isConnectionError = (err) =>
  CONNECTION_ERROR_CODES.has(err?.code) ||
  /Connection terminated|connection error|terminating connection/i.test(err?.message ?? '');

// When we pass explicit TLS options, drop TLS parameters from the URL:
// node-postgres lets URL parameters override the `ssl` option, and
// `sslmode=require` in a copied Supabase URL would discard our CA.
function stripSslParams(connectionString) {
  const url = new URL(connectionString);
  for (const key of ['sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'ssl']) url.searchParams.delete(key);
  return url.toString();
}

export async function createPgStore(connectionString, { ssl } = {}) {
  const pool = new pg.Pool({
    connectionString: ssl ? stripSslParams(connectionString) : connectionString,
    ssl,
    max: Number(process.env.DATABASE_POOL_MAX || 10),
    connectionTimeoutMillis: 10_000,
    // Hosted poolers (Supabase Supavisor, PgBouncer) close idle connections on
    // their side; keep sockets alive and retire idle clients before that happens.
    keepAlive: true,
    idleTimeoutMillis: 10_000,
  });
  // A dropped idle connection (common with hosted poolers) must not crash the server.
  pool.on('error', (err) => console.error('[db] idle client error:', err.message));
  await migrate(pool);

  const fromRow = (row) => {
    if (!row) return null;
    const out = {};
    for (const [key, col] of Object.entries(COLUMNS)) out[key] = row[col] ?? null;
    return out;
  };
  // Hosted poolers can close a pooled connection at any time; the next query on
  // it fails with "Connection terminated unexpectedly". Statements that are safe
  // to repeat (reads, and updates that set fixed values) are retried once on a
  // fresh connection. Inserts and increments are never retried, so a retry can't
  // create duplicates.
  const query = async (sql, params) => {
    try {
      return await pool.query(sql, params);
    } catch (err) {
      if (!isConnectionError(err)) throw err;
      console.warn(`[db] connection dropped (${err.message}); retrying once`);
      return pool.query(sql, params);
    }
  };
  const one = async (sql, params) => fromRow((await query(sql, params)).rows[0]);
  const many = async (sql, params) => (await query(sql, params)).rows.map(fromRow);

  const insertSql = (record) => {
    const keys = Object.keys(COLUMNS).filter((k) => record[k] !== undefined);
    return {
      text: `INSERT INTO credentials (${keys.map((k) => COLUMNS[k]).join(', ')})
             VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`,
      values: keys.map((k) => record[k]),
    };
  };

  const userFromRow = (r) =>
    r && {
      username: r.username,
      passwordHash: r.password_hash,
      role: r.role,
      studentId: r.student_id,
      email: r.email,
      institutionId: r.institution_id,
      failedAttempts: r.failed_attempts,
      lockedUntil: r.locked_until ? new Date(r.locked_until).toISOString() : null,
    };
  const institutionFromRow = (r) => {
    if (!r) return null;
    const out = {};
    for (const [key, col] of Object.entries(INSTITUTION_COLUMNS)) {
      const v = r[col] ?? null;
      out[key] = v instanceof Date ? v.toISOString() : v;
    }
    return out;
  };
  const studentFromRow = (r) =>
    r && { studentId: r.student_id, fullName: r.full_name, email: r.email, institutionId: r.institution_id, source: r.source };

  return {
    kind: 'postgres',
    async insert(record) {
      const { text, values } = insertSql(record);
      return fromRow((await pool.query(text, values)).rows[0]);
    },
    // All-or-nothing: a batch is either fully recorded or not at all.
    async insertMany(records) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const out = [];
        for (const r of records) out.push(fromRow((await client.query(insertSql(r))).rows[0]));
        await client.query('COMMIT');
        return out;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },
    async update(credentialId, patch) {
      const keys = Object.keys(patch).filter((k) => COLUMNS[k]);
      const sets = keys.map((k, i) => `${COLUMNS[k]} = $${i + 2}`);
      return one(`UPDATE credentials SET ${sets.join(', ')} WHERE credential_id = $1 RETURNING *`, [
        credentialId,
        ...keys.map((k) => patch[k]),
      ]);
    },
    get: (id) => one('SELECT * FROM credentials WHERE credential_id = $1', [id]),
    findByHash: (hash) => one('SELECT * FROM credentials WHERE doc_hash = $1', [hash]),
    findByCertificateNo: (no) => one('SELECT * FROM credentials WHERE certificate_no = $1', [no]),
    listByStudent: (sid) =>
      many('SELECT * FROM credentials WHERE student_id = $1 ORDER BY created_at DESC', [sid]),
    listAll: () => many('SELECT * FROM credentials ORDER BY created_at DESC'),
    listByInstitution: (iid) =>
      many('SELECT * FROM credentials WHERE institution_id = $1 ORDER BY created_at DESC', [iid]),

    async getUser(username) {
      return userFromRow((await query('SELECT * FROM users WHERE username = $1', [username])).rows[0]);
    },
    async findUserForLogin(login) {
      const { rows } = await query('SELECT * FROM users WHERE username = $1 OR email = $2 LIMIT 1', [login, lower(login)]);
      return userFromRow(rows[0]);
    },
    async createUser({ username, passwordHash, role, studentId = null, email = null, institutionId = null }) {
      await pool.query(
        `INSERT INTO users (username, password_hash, role, student_id, email, institution_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [username, passwordHash, role, studentId, lower(email), institutionId]
      );
    },
    async updateUser(username, { institutionId }) {
      await query('UPDATE users SET institution_id = $2 WHERE username = $1', [username, institutionId]);
    },

    async getInstitution(id) {
      return institutionFromRow((await query('SELECT * FROM institutions WHERE id = $1', [id])).rows[0]);
    },
    async findInstitutionByAddress(address) {
      return institutionFromRow(
        (await query('SELECT * FROM institutions WHERE lower(wallet_address) = $1', [lower(address)])).rows[0]
      );
    },
    async findInstitutionByName(name) {
      return institutionFromRow((await query('SELECT * FROM institutions WHERE lower(name) = $1', [lower(name)])).rows[0]);
    },
    async listInstitutions() {
      return (await query('SELECT * FROM institutions ORDER BY created_at')).rows.map(institutionFromRow);
    },
    async createInstitution(inst) {
      const keys = Object.keys(INSTITUTION_COLUMNS).filter((k) => inst[k] !== undefined);
      const { rows } = await pool.query(
        `INSERT INTO institutions (${keys.map((k) => INSTITUTION_COLUMNS[k]).join(', ')})
         VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`,
        keys.map((k) => inst[k])
      );
      return institutionFromRow(rows[0]);
    },
    async updateInstitution(id, patch) {
      const keys = Object.keys(patch).filter((k) => INSTITUTION_COLUMNS[k] && k !== 'id');
      const sets = keys.map((k, i) => `${INSTITUTION_COLUMNS[k]} = $${i + 2}`);
      const { rows } = await query(`UPDATE institutions SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, [
        id,
        ...keys.map((k) => patch[k]),
      ]);
      return institutionFromRow(rows[0]);
    },

    async getStudent(studentId) {
      return studentFromRow((await query('SELECT * FROM students WHERE student_id = $1', [studentId])).rows[0]);
    },
    async findStudentByEmail(email) {
      return studentFromRow((await query('SELECT * FROM students WHERE email = $1', [lower(email)])).rows[0]);
    },
    async upsertStudent({ studentId, fullName, email = null, institutionId = null, source = 'issuance' }) {
      const { rows } = await pool.query(
        `INSERT INTO students (student_id, full_name, email, institution_id, source)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (student_id) DO UPDATE SET
           full_name      = EXCLUDED.full_name,
           email          = COALESCE(EXCLUDED.email, students.email),
           institution_id = COALESCE(students.institution_id, EXCLUDED.institution_id)
         RETURNING *`,
        [studentId, fullName, lower(email), institutionId, source]
      );
      return studentFromRow(rows[0]);
    },
    async countUsers() {
      return Number((await query('SELECT count(*) FROM users')).rows[0].count);
    },
    async recordLoginFailure(username, { maxAttempts, lockMs }) {
      await pool.query(
        `UPDATE users SET
           locked_until    = CASE WHEN failed_attempts + 1 >= $2 THEN now() + ($3 || ' milliseconds')::interval ELSE locked_until END,
           failed_attempts = CASE WHEN failed_attempts + 1 >= $2 THEN 0 ELSE failed_attempts + 1 END
         WHERE username = $1`,
        [username, maxAttempts, String(lockMs)]
      );
    },
    async resetLoginFailures(username) {
      await query('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE username = $1', [username]);
    },

    async addAudit({ actor = null, action, target = null, ip = null, details = null }) {
      await pool.query('INSERT INTO audit_log (actor, action, target, ip, details) VALUES ($1, $2, $3, $4, $5)', [
        actor,
        action,
        target,
        ip,
        details,
      ]);
    },
    async listAudit(limit = 100) {
      const { rows } = await query('SELECT * FROM audit_log ORDER BY id DESC LIMIT $1', [limit]);
      return rows.map((r) => ({ ...r, at: new Date(r.at).toISOString() }));
    },

    // For bulk imports and maintenance scripts only; the API never uses it.
    raw: (sql, params) => pool.query(sql, params),
    connect: () => pool.connect(),
    close: () => pool.end(),
  };
}
