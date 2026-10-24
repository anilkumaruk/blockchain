// Vercel serverless entry for the Chain of Record API. Every /api/* request is
// rewritten here (see vercel.json); the Express app handles the routing.
// Configuration comes from the Vercel project's environment variables, and the
// registry address + ABI from backend/deployments/sepolia.json.

import { createRequire } from 'node:module';
import { loadConfig } from '../backend/server/config.js';
import { createRuntime } from '../backend/server/runtime.js';

const require = createRequire(import.meta.url);
const deployment = require('../backend/deployments/sepolia.json');

let appPromise = null;

function getApp() {
  appPromise ??= (async () => {
    const { config, errors } = loadConfig();
    if (errors.length) throw new Error(`Server configuration error: ${errors.join(' ')}`);
    const runtime = await createRuntime(config, deployment, { bootstrapAdmin: false });
    return runtime.app;
  })().catch((err) => {
    appPromise = null; // retry on the next request instead of caching the failure
    throw err;
  });
  return appPromise;
}

export default async function handler(req, res) {
  try {
    const app = await getApp();
    return app(req, res);
  } catch (err) {
    console.error(err);
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ status: 'unavailable', error: 'The API is not configured or cannot start.' }));
  }
}
