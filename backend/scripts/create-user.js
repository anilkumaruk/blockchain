// Creates a user account in the PostgreSQL users table.
//
//   node scripts/create-user.js <username> <admin|student> [studentId]
//
// The password is read from the NEW_USER_PASSWORD env var, or prompted for
// (hidden) so it never lands in shell history.

import 'dotenv/config';
import readline from 'node:readline';
import { Writable } from 'node:stream';
import { createPgStore } from '../server/store.js';
import { hashPassword } from '../server/passwords.js';
import { databaseSslFromEnv } from '../server/config.js';

const [username, role, studentId] = process.argv.slice(2);
if (!username || !['admin', 'student'].includes(role) || (role === 'student' && !studentId)) {
  console.error('Usage: node scripts/create-user.js <username> <admin|student> [studentId]');
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}

async function promptHidden(question) {
  const muted = new Writable({ write: (_chunk, _enc, cb) => cb() });
  process.stdout.write(question);
  const rl = readline.createInterface({ input: process.stdin, output: muted, terminal: true });
  const answer = await new Promise((resolve) => rl.question('', resolve));
  rl.close();
  process.stdout.write('\n');
  return answer;
}

const password = process.env.NEW_USER_PASSWORD || (await promptHidden(`Password for ${username}: `));
const db = databaseSslFromEnv();
if (db.errors.length) {
  console.error(db.errors.join('\n'));
  process.exit(1);
}
const store = await createPgStore(process.env.DATABASE_URL, { ssl: db.ssl });
try {
  await store.createUser({ username, passwordHash: await hashPassword(password), role, studentId });
  console.log(`Created ${role} "${username}"${studentId ? ` (student ${studentId})` : ''}.`);
} catch (err) {
  console.error(`Could not create user: ${err.message}`);
  process.exitCode = 1;
} finally {
  await store.close();
}
