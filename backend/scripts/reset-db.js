// Deletes ALL application data (institutions, users, students, credentials,
// academic records, audit log). The schema and migrations are kept.
//
//   node scripts/reset-db.js --confirm
//
// The blockchain is not touched; deploy a fresh registry (npm run deploy:local)
// if on-chain records should be cleared too.

import 'dotenv/config';
import { loadConfig } from '../server/config.js';
import { createPgStore } from '../server/store.js';

if (!process.argv.includes('--confirm')) {
  console.error('This deletes every row of application data. Re-run with --confirm.');
  process.exit(1);
}
const { config, errors } = loadConfig();
if (errors.length || !config.databaseUrl) {
  console.error(errors.join('\n') || 'DATABASE_URL is not set.');
  process.exit(1);
}
const store = await createPgStore(config.databaseUrl, { ssl: config.databaseSsl });
const tables = [
  'verification_requests', 'nad_awards', 'degree_certificates', 'semester_results', 'enrollments',
  'programs', 'colleges', 'credentials', 'users', 'students', 'institutions', 'audit_log',
];
const { rows } = await store.raw(
  `SELECT tablename FROM pg_tables WHERE schemaname = current_schema() AND tablename = ANY($1)`,
  [tables]
);
const present = rows.map((r) => r.tablename);
await store.raw(`TRUNCATE ${present.join(', ')} RESTART IDENTITY CASCADE`);
console.log(`Emptied ${present.length} tables: ${present.join(', ')}`);
await store.close();
