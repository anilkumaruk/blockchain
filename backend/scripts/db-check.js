// Checks the database connection configured in .env (e.g. Supabase) and
// runs pending migrations. Prints no credentials.
//
//   npm run db:check

import 'dotenv/config';
import pg from 'pg';
import { createPgStore } from '../server/store.js';
import { databaseSslFromEnv } from '../server/config.js';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set in backend/.env');
  process.exit(1);
}
const { ssl, errors, warnings } = databaseSslFromEnv();
for (const w of warnings) console.warn(`warning: ${w}`);
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}

const { hostname, port, username } = new URL(url);
console.log(`Connecting to ${hostname}:${port || 5432} as ${username} (TLS: ${ssl ? (ssl.rejectUnauthorized ? 'verified' : 'unverified') : 'off'})...`);

let store;
try {
  store = await createPgStore(url, { ssl });
} catch (err) {
  console.error(`\nConnection failed: ${err.message}`);
  if (/ENOTFOUND|ENETUNREACH|EHOSTUNREACH/.test(err.code ?? err.message) && hostname.startsWith('db.')) {
    console.error('Hint: Supabase direct hosts (db.<ref>.supabase.co) are IPv6-only. Use the "Session pooler" connection string instead.');
  }
  if (/self-signed|certificate/i.test(err.message)) {
    console.error('Hint: set DATABASE_SSL_CA to the CA certificate downloaded from Supabase (Project Settings -> Database -> SSL Configuration).');
  }
  if (/password authentication failed|Tenant or user not found/i.test(err.message)) {
    console.error('Hint: check the database password and, for the pooler, that the user is postgres.<project-ref>.');
  }
  process.exit(1);
}

const client = new pg.Client({ connectionString: url.replace(/[?&]sslmode=[^&]*/, ''), ssl });
await client.connect();
const q = async (sql) => (await client.query(sql)).rows;
const [{ version }] = await q('SELECT version()');
const [{ ssl: tls }] = await q('SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()');
const migrations = await q('SELECT name FROM schema_migrations ORDER BY name');
// Only this app's schema: hosted providers have same-named tables elsewhere
// (e.g. Supabase's auth.users, realtime.schema_migrations).
const tables = await q(`SELECT relname, relrowsecurity FROM pg_class
  WHERE relname IN ('credentials','users','audit_log','schema_migrations','institutions','students','colleges','programs','enrollments','semester_results','degree_certificates','nad_awards','verification_requests') AND relkind = 'r'
    AND relnamespace = current_schema()::regnamespace ORDER BY relname`);
const counts = await q(`SELECT (SELECT count(*) FROM credentials) AS credentials,
  (SELECT count(*) FROM users) AS users, (SELECT count(*) FROM institutions) AS institutions, (SELECT count(*) FROM students) AS students, (SELECT count(*) FROM audit_log) AS audit_entries`);
await client.end();
await store.close();

console.log(`\nConnected: ${version.split(' on ')[0]}`);
console.log(`TLS in use: ${tls}`);
console.log(`Migrations: ${migrations.map((m) => m.name).join(', ')}`);
console.log(`Row Level Security: ${tables.map((t) => `${t.relname}=${t.relrowsecurity ? 'on' : 'OFF'}`).join(', ')}`);
console.log(`Rows: ${JSON.stringify(counts[0])}`);
