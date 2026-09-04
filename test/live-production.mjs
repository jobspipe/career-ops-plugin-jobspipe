// Live test against PRODUCTION JobsPipe. Requires JOBSPIPE_API_KEY.
// Skips (exit 0) when no key is present so CI without secrets stays green.
import assert from 'node:assert';
import plugin from '../index.mjs';

const key = process.env.JOBSPIPE_API_KEY;
if (!key) { console.log('- live-production skipped (no JOBSPIPE_API_KEY)'); process.exit(0); }

const ctx = {
  env: { JOBSPIPE_API_KEY: key },
  async fetchJson(url, opts) {
    const res = await fetch(url, { method: opts.method, headers: opts.headers, body: opts.body });
    if (!res.ok) { const e = new Error(`HTTP ${res.status}`); e.status = res.status; throw e; }
    return res.json();
  },
};

const jobs = await plugin.provider.fetch(
  { name: 'Live', jobspipe: { job_title_or: ['software engineer'], skills_or: ['react'], posted_at_max_age_days: 30, limit: 10 } },
  ctx,
);

assert(jobs.length > 0, 'production returned no mappable jobs — link field mapping is broken');
for (const j of jobs) {
  assert(j.title, 'every job needs a title');
  assert(j.url && j.url.startsWith('http'), `every job needs an absolute url, got "${j.url}"`);
  assert(j.company, 'every job needs a company');
}
console.log(`✓ live production ok: ${jobs.length}/10 mapped with links`);
for (const j of jobs.slice(0, 4)) console.log(`  - ${j.title} @ ${j.company} — ${j.location}\n    ${j.url.slice(0, 88)}`);
