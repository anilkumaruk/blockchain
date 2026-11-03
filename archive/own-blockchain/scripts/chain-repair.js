// Overwrites any corrupted or lagging validator copy from the healthy majority.
//   npm run chain:repair

import 'dotenv/config';
import { loadConfig } from '../server/config.js';
import { createPgStore } from '../server/store.js';
import { createLedgerFor } from '../server/runtime.js';

const { config } = loadConfig();
const store = await createPgStore(config.databaseUrl, { ssl: config.databaseSsl });
const ledger = createLedgerFor(config, store);
console.log('repaired:', await ledger.repair());
(await ledger.explorer.audit({ deep: true })).forEach((n) =>
  console.log(n.node, n.valid ? 'VALID' : `INVALID at ${n.invalidAt}: ${n.problem}`, 'height', n.height)
);
await store.close();
