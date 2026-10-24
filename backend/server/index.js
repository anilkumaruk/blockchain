// Local/dev entrypoint. Reads configuration from the environment (see
// .env.example), connects to the database and the deployed registry, and
// starts the API.

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { createRuntime } from './runtime.js';

const here = path.dirname(fileURLToPath(import.meta.url));

const { config, errors, warnings } = loadConfig();
for (const w of warnings) console.warn(`[config] warning: ${w}`);
if (errors.length) {
  for (const e of errors) console.error(`[config] error: ${e}`);
  process.exit(1);
}

const file = path.join(here, '..', 'deployments', `${config.network}.json`);
if (!fs.existsSync(file)) {
  console.error(`No deployment found at ${file}. Run "npm run deploy:${config.network}" first.`);
  process.exit(1);
}
const deployment = JSON.parse(fs.readFileSync(file, 'utf8'));

let runtime;
try {
  runtime = await createRuntime(config, deployment);
} catch (err) {
  console.error(`[config] error: ${err.message}`);
  process.exit(1);
}

runtime.app.listen(config.port, () => {
  console.log(`Chain of Record API on http://localhost:${config.port}`);
  console.log(`  registry: ${runtime.contract.target} (${config.network}, chainId ${deployment.chainId})`);
  console.log(`  issuer:   ${runtime.signer.address}`);
  console.log(`  store:    ${runtime.store.kind}`);
});
