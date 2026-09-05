// Zero-network test for the market brief's pure functions.
import assert from 'node:assert';
import { parseArgs, aggregate, dedupeRoles, normCompany, matchCv, renderText, renderMarkdown, renderSvg, readDotEnv, fetchSample } from '../_brief.mjs';
import { writeFileSync, unlinkSync } from 'node:fs';

let seq = 0;
const row = (over) => ({ id: Math.random().toString(36).slice(2), company: 'Acme', job_title: `Role ${++seq}`, employer_type: 'employer', seniority: 'senior',
  technology_slugs: ['rust', 'kubernetes', 'grpc'], avg_annual_salary_usd: 160000, remote: true, sources: [{ provider: 'greenhouse' }], ...over });

// args
assert.deepStrictEqual(parseArgs(['--skill', 'rust', '--country', 'us', '--remote', '--days', '7']).countries, ['US']);
assert.throws(() => parseArgs([]), /--skill or --title/);
assert.throws(() => parseArgs(['--bogus']), /unknown argument/);

// aggregate: query skill excluded, shares correct, aggregators excluded from hiring, thin strata dropped
const rows = [
  ...Array.from({ length: 6 }, () => row({})),
  ...Array.from({ length: 4 }, () => row({ technology_slugs: ['rust', 'python'], seniority: 'entry_level', avg_annual_salary_usd: 90000 })),
  row({ company: 'jobgether', technology_slugs: ['rust', 'kubernetes'] }), // labelled 'employer' by the API, like the real thing
  // one role, three cities — must count once
  row({ company: 'MassCo', job_title: 'Graduate Engineer', seniority: 'entry_level', avg_annual_salary_usd: 161111, technology_slugs: ['rust', 'java'] }),
  row({ company: 'MassCo', job_title: 'Graduate Engineer', seniority: 'entry_level', avg_annual_salary_usd: 161111, technology_slugs: ['rust', 'java'] }),
  row({ company: 'MassCo', job_title: 'Graduate Engineer', seniority: 'entry_level', avg_annual_salary_usd: 161111, technology_slugs: ['rust', 'java'] }),
];
const a = aggregate(rows, { querySkills: ['rust'], top: 5 });
assert.strictEqual(a.postings, 14, 'raw postings');
assert.strictEqual(a.n, 12, '14 postings → 12 unique roles (MassCo ×3 collapses to 1)');
assert(!a.skills.some((s) => s.slug === 'rust'), 'query skill must be excluded');
assert.strictEqual(a.skills[0].slug, 'kubernetes'); assert.strictEqual(a.skills[0].count, 7);
assert(!a.employers.some((e) => e.key === 'jobgether'), 'known reposters must not top the hiring list even when labelled employer');
assert.strictEqual(a.skills.find((s) => s.slug === 'java').count, 1, 'a mass multi-location posting counts once');
assert.strictEqual(a.salary.parsed, 12);
assert(a.salary.bySeniority.find((s) => s.seniority === 'senior').n === 7);
assert(!a.salary.bySeniority.find((s) => s.seniority === 'entry_level') || a.salary.bySeniority.find((s) => s.seniority === 'entry_level').n === 5, 'entry stratum must not be inflated by the duplicate');
assert(!a.salary.bySeniority.find((s) => s.seniority === 'unlabeled'), 'strata under 5 points are dropped');
assert.strictEqual(a.salary.overall.p50, 160000);

// dedupe edge cases: missing title never collapses; legal suffixes merge
assert.strictEqual(dedupeRoles([row({ job_title: '' }), row({ job_title: '' })]).length, 2, 'rows without a title must stay distinct');
assert.strictEqual(normCompany('GitLab Inc.'), 'gitlab'); assert.strictEqual(normCompany('GitLab'), 'gitlab');
const g = aggregate([row({ company: 'GitLab Inc', job_title: 'A' }), row({ company: 'GitLab', job_title: 'B' })], { top: 3 });
assert.deepStrictEqual(g.employers, [{ key: 'GitLab Inc', count: 2 }], 'GitLab and GitLab Inc are one employer');

// cv matching: alias, multiword slug, short-slug scoping to the Skills section
const cv = `# Jane Doe\nI like going to the gym.\n\n## Skills\n- K8s, Postgres, TypeScript\n- system design\n\n## Experience\nWrote services in golang.`;
const m = Object.fromEntries(matchCv(cv, [{ slug: 'kubernetes' }, { slug: 'postgresql' }, { slug: 'system-design' }, { slug: 'go' }, { slug: 'grpc' }, { slug: 'c' }]).map((s) => [s.slug, s.have]));
assert.strictEqual(m.kubernetes, true, 'alias k8s');
assert.strictEqual(m.postgresql, true, 'alias postgres');
assert.strictEqual(m['system-design'], true, 'multiword slug');
assert.strictEqual(m.go, false, '"go" must not match "going" in prose; only the Skills section counts for 2-letter slugs');
assert.strictEqual(m.grpc, false);
assert.strictEqual(m.c, false);
assert.strictEqual(matchCv('', [{ slug: 'x' }])[0].have, null, 'no cv → unknown, not false');

// renderers don't throw and carry the honesty line
const o = parseArgs(['--skill', 'rust', '--remote']);
a.skills = matchCv(cv, a.skills); a.total = 577;
for (const out of [renderText(a, o, 577, true), renderMarkdown(a, o, 577, true)]) assert(/wishlists/.test(out), 'must carry the "postings are wishlists" caveat');
const svg = renderSvg(a, o, true);
assert(svg.startsWith('<svg') && svg.includes('kubernetes') && svg.includes('in cv.md'));

// .env parsing
writeFileSync('/tmp/_brief_test.env', '# c\nexport JOBSPIPE_API_KEY="jp_live_x"\nOTHER=1\n');
assert.strictEqual(readDotEnv('/tmp/_brief_test.env').JOBSPIPE_API_KEY, 'jp_live_x'); unlinkSync('/tmp/_brief_test.env');

// pagination: dedupes by id, stops on short page, requests total only on first page
let calls = [];
const fake = async (_k, p) => { calls.push(p); const ids = p.offset === 0 ? ['a', 'b'] : ['b', 'c']; return { metadata: { total_results: 3 }, data: ids.map((id) => row({ id })) }; };
const r = await fetchSample('k', { ...o, sample: 10, pageSize: 2 }, fake);
assert.strictEqual(r.total, 3); assert.deepStrictEqual(r.rows.map((x) => x.id), ['a', 'b', 'c']);
assert.strictEqual(calls[0].include_total_results, true); assert.strictEqual(calls[1].include_total_results, false);

console.log('✓ brief ok');
