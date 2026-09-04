// Live test against JobsPipe's public sandbox — no API key required.
// Exercises the real provider.fetch() path (payload build → HTTP → mapping)
// against a genuine JobsPipe response envelope, so a field rename upstream
// fails here instead of silently returning zero jobs in a user's scan.
import assert from 'node:assert';
import plugin, { mapJob } from '../index.mjs';

const SANDBOX = 'https://api.jobspipe.dev/v1/sandbox/jobs/search';

// Stand-in for career-ops's guarded ctx.fetchJson. Redirects to the sandbox so
// no key is needed; mirrors the real one's throw-on-non-2xx contract.
let sentPayload = null;
const ctx = {
  env: { JOBSPIPE_API_KEY: 'jp_live_sandbox_dummy' },
  async fetchJson(_url, opts) {
    sentPayload = JSON.parse(opts.body);
    const res = await fetch(SANDBOX, { method: 'POST', headers: opts.headers, body: opts.body });
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return res.json();
  },
};

const jobs = await plugin.provider.fetch(
  { name: 'Sandbox', scan_query: 'backend engineer', jobspipe: { job_country_code_or: ['US'], skills_or: ['python'], limit: 5 } },
  ctx,
);

// The payload we build must be what JobsPipe documents.
assert.deepStrictEqual(sentPayload.job_title_or, ['backend engineer'], 'scan_query -> job_title_or');
assert.deepStrictEqual(sentPayload.job_country_code_or, ['US'], 'passthrough filter forwarded');
assert.deepStrictEqual(sentPayload.skills_or, ['python'], 'skills_or forwarded');
assert.strictEqual(sentPayload.limit, 5, 'limit forwarded');
assert.strictEqual(sentPayload.posted_at_max_age_days, 14, 'age defaults to 14');

// The mapping must produce career-ops Job shape from a real response.
assert(jobs.length > 0, 'sandbox returned no mappable jobs');
for (const j of jobs) {
  for (const f of ['title', 'url', 'company', 'location'])
    assert(typeof j[f] === 'string', `job.${f} must be a string`);
  assert(j.title && j.url, 'title and url must be non-empty after filtering');
  assert(j.url.startsWith('http'), `url must be absolute, got "${j.url}"`);
  assert(!/\[object/.test(j.company), 'company must never stringify as [object Object]');
}

// final_url is the field that carries the link — guard the rename explicitly.
assert.strictEqual(
  mapJob({ job_title: 'X', final_url: 'https://e.com/1', company: 'C', location: 'L' }).url,
  'https://e.com/1', 'must read final_url, not url');
// Both schemas must map: live records carry `url`, sandbox/docs carry `final_url`.
assert.strictEqual(mapJob({ job_title: 'X', url: 'https://live.example/1' }).url,
  'https://live.example/1', 'live shape: must read `url`');
assert.strictEqual(mapJob({ job_title: 'X', final_url: null, source_url: 'https://src.example/1' }).url,
  'https://src.example/1', 'must fall back to source_url when final_url is null');
assert.strictEqual(mapJob({ job_title: 'X', sources: [{ url: 'https://s.example/1' }] }).url,
  'https://s.example/1', 'must fall back to sources[0].url');
// Object-shaped company degrades to the name.
assert.strictEqual(mapJob({ job_title: 'X', final_url: 'https://e.com', company: { name: 'Acme' } }).company, 'Acme');

console.log(`✓ live sandbox ok: ${jobs.length} jobs mapped`);
console.log(`  e.g. ${jobs[0].title} @ ${jobs[0].company} — ${jobs[0].location}`);
