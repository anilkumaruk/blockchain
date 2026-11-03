// Local/dev entrypoint. Reads configuration from the environment (see
// .env.example), connects to the database and the deployed registry, and
// starts the API.

import 'dotenv/config';
import fs from 'node:fs';
import { loadConfig } from './config.js';
import { createRuntime } from './runtime.js';

const { config, errors, warnings } = loadConfig();
for (const w of warnings) console.warn(`[config] warning: ${w}`);
if (errors.length) {
  for (const e of errors) console.error(`[config] error: ${e}`);
  process.exit(1);
}

function loadDeployment() {
  if (config.network !== 'sepolia') return undefined; // local runs do not touch the public network
  return JSON.parse(fs.readFileSync(new URL('../deployments/sepolia.json', import.meta.url)));
}

let runtime;
try {
  runtime = await createRuntime(config, { deployment: loadDeployment() });
} catch (err) {
  console.error(`[config] error: ${err.message}`);
  process.exit(1);
}

runtime.app.listen(config.port, () => {
  console.log(`Chain of Record API on http://localhost:${config.port}`);
  console.log(`  blockchain: own chain, authority ${runtime.ledger.authority}`);
  console.log(`  store:    ${runtime.store.kind}`);
});
