// Zero-network smoke test: the plugin imports cleanly and exposes valid hooks
// that match the manifest. Run by `plugins.mjs add` + the registry CI.
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const KINDS = ['provider', 'ingest', 'search', 'notify', 'export'];

const manifest = JSON.parse(readFileSync(path.join(here, '..', 'manifest.json'), 'utf8'));
const mod = await import(path.join(here, '..', manifest.entry || 'index.mjs'));
const hooks = mod.default;

assert(hooks && typeof hooks === 'object', 'default export must be an object of hooks');
const keys = Object.keys(hooks);
assert(keys.length > 0, 'declare at least one hook');
for (const k of keys) assert(KINDS.includes(k), `unknown hook "${k}"`);
for (const h of manifest.hooks)
  assert(keys.includes(h), `manifest declares hook "${h}" but index.mjs does not export it`);

const p = hooks.provider;
assert(p && typeof p === 'object', 'provider hook must be an object');
assert(p.id === manifest.id, `provider.id "${p.id}" must match manifest.id "${manifest.id}"`);
assert(typeof p.detect === 'function', 'provider must export detect()');
assert(typeof p.fetch === 'function', 'provider must export a fetch method');

assert(p.detect({ provider: 'jobspipe' }), 'detect({provider:"jobspipe"}) must match');
assert(p.detect({ scan_method: 'jobspipe' }), 'detect({scan_method:"jobspipe"}) must match');
const miss = p.detect({ careers_url: 'https://jobs.ashbyhq.com/acme' });
assert(miss === null || miss === undefined, 'detect() must return null for non-jobspipe entries');

// Manifest hygiene the registry CI checks for.
assert(manifest.humanInTheLoop === true, 'humanInTheLoop must be true');
assert(manifest.requiredEnv.length && manifest.allowedHosts.length,
  'allowedHosts is required when requiredEnv is non-empty');

console.log('✓ smoke ok:', keys.join(', '));
