#!/usr/bin/env node
// @ts-check
// _brief.mjs — market brief: what live postings in your niche mention, what
// they pay, and where your cv.md falls short. Computed from a sample of
// current postings, not from a survey or a blog post.
//
//   node plugins.local/jobspipe/_brief.mjs --skill rust --remote
//   node plugins.local/jobspipe/_brief.mjs --title "platform engineer" --country US --days 7
//   node plugins.local/jobspipe/_brief.mjs --skill rust --md brief.md --svg brief.svg
//
// The `_` prefix means career-ops never discovers this as a plugin; it is a
// helper you run directly. It reads JOBSPIPE_API_KEY from the career-ops
// .env (or the environment) and cv.md from the career-ops root. Only search
// filters leave the machine — never cv.md, never pipeline state.
//
// Egress note (same arrangement as the bundled apify plugin's _apify.mjs):
// this helper runs standalone, outside the engine, so there is no ctx.fetch to
// route through. It self-constrains harder than allowedHosts would — every
// request is built from the single hardcoded API_BASE below and one fixed
// path, so it can only ever reach api.jobspipe.dev. The manifest's
// allowedHosts mirrors that.
//
// Credits: one credit is one job returned. --sample 100 costs 100 credits.
// The free plan has 1,000 a month, so a full-size brief is a weekly habit
// there, not a daily one. The script prints the cost before it spends it.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const API_BASE = 'https://api.jobspipe.dev';
const SEARCH_PATH = '/v1/jobs/search';

// ── args ─────────────────────────────────────────────────────────────────
export function parseArgs(argv) {
  const o = { skills: [], titles: [], countries: [], seniority: [], days: 14, sample: 100, pageSize: 25, top: 12 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], v = () => argv[++i];
    if (a === '--skill') o.skills.push(v());
    else if (a === '--title') o.titles.push(v());
    else if (a === '--country') o.countries.push(v().toUpperCase());
    else if (a === '--seniority') o.seniority.push(v());
    else if (a === '--remote') o.remote = true;
    else if (a === '--days') o.days = Number(v());
    else if (a === '--sample') o.sample = Number(v());
    else if (a === '--page-size') o.pageSize = Number(v());
    else if (a === '--top') o.top = Number(v());
    else if (a === '--cv') o.cv = v();
    else if (a === '--md') o.md = v();
    else if (a === '--svg') o.svg = v();
    else if (a === '--json') o.json = true;
    else if (a === '--help' || a === '-h') o.help = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  if (!o.help && !o.skills.length && !o.titles.length) throw new Error('give at least one --skill or --title');
  return o;
}

const USAGE = `Usage:
  node _brief.mjs --skill <slug> [--skill <slug>] [--title <text>] [--country <ISO2>]
                  [--seniority <level>] [--remote] [--days 14] [--sample 100]
                  [--cv cv.md] [--md out.md] [--svg out.svg] [--json]`;

// ── root / env / cv ──────────────────────────────────────────────────────
// Walk up from this file until we find plugins.mjs — that is the career-ops
// root whether we live in plugins/ or plugins.local/. Fall back to cwd.
export function findRoot(from) {
  let d = from;
  for (let i = 0; i < 6; i++) {
    if (existsSync(path.join(d, 'plugins.mjs'))) return d;
    const up = path.dirname(d);
    if (up === d) break;
    d = up;
  }
  return process.cwd();
}

export function readDotEnv(file) {
  if (!existsSync(file)) return {};
  const out = {};
  for (const raw of readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let val = m[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    out[m[1]] = val;
  }
  return out;
}

// ── fetch ────────────────────────────────────────────────────────────────
async function searchPage(apiKey, payload) {
  const res = await globalThis.fetch(API_BASE + SEARCH_PATH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const s = res.status;
    if (s === 401) throw new Error('401 — JOBSPIPE_API_KEY is missing or invalid (keys look like jp_live_...)');
    if (s === 402) throw new Error('402 — this key has used its monthly job allowance; it resets next cycle');
    if (s === 429) throw new Error(`429 — rate limited${res.headers.get('retry-after') ? ` (retry after ${res.headers.get('retry-after')}s)` : ''}`);
    throw new Error(`HTTP ${s}`);
  }
  return res.json();
}

export async function fetchSample(apiKey, o, fetchImpl = searchPage) {
  const base = { posted_at_max_age_days: o.days, limit: o.pageSize };
  if (o.skills.length) base.skills_or = o.skills;
  if (o.titles.length) base.job_title_or = o.titles;
  if (o.countries.length) base.job_country_code_or = o.countries;
  if (o.seniority.length) base.job_seniority_or = o.seniority;
  if (o.remote) base.remote = true;

  const rows = [], seen = new Set();
  let total = null, offset = 0;
  while (rows.length < o.sample) {
    const page = await fetchImpl(apiKey, { ...base, offset, include_total_results: offset === 0 });
    if (offset === 0) total = page?.metadata?.total_results ?? null;
    const data = Array.isArray(page?.data) ? page.data : [];
    let fresh = 0;
    for (const r of data) {
      if (r?.id && !seen.has(r.id)) { seen.add(r.id); rows.push(r); fresh++; }
      if (rows.length >= o.sample) break;
    }
    // stop on a short page or a page of nothing new — both mean the pool is done
    if (data.length < o.pageSize || fresh === 0) break;
    offset += data.length;
  }
  return { rows, total };
}

// ── aggregation (pure) ───────────────────────────────────────────────────
const q = (arr, p) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const i = (s.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i);
  return s[lo] + (s[hi] - s[lo]) * (i - lo);
};
const salaryOf = (r) => r.avg_annual_salary_usd ?? (r.min_annual_salary_usd && r.max_annual_salary_usd ? (r.min_annual_salary_usd + r.max_annual_salary_usd) / 2 : null);

// Platforms that repost employers' roles under their own name. The API labels
// these employer_type "employer" (verified: 100/100 rows in a live sample), so
// the field cannot be used to exclude them. Extend as you meet more.
export const KNOWN_REPOSTERS = new Set(['jobgether', 'hire feed', 'lensa', 'talent.com', 'jooble', 'adzuna', 'jobrapido', 'neuvoo']);
const isReposter = (r) => KNOWN_REPOSTERS.has(normCompany(r.company));

// One role posted in eleven cities is one role. Collapse (company, title) so a
// mass multi-location posting cannot dominate skill shares or a salary stratum.
// "GitLab" and "GitLab Inc" are one employer: strip legal suffixes and
// punctuation for grouping, keep the first-seen spelling for display.
export const normCompany = (name) => (name || '').toLowerCase().replace(/[.,]/g, '').replace(/\s+(inc|llc|ltd|limited|gmbh|corp|corporation|co|plc|sa|ag|bv)$/i, '').trim();

export function dedupeRoles(rows) {
  const seen = new Set(), out = [];
  for (const r of rows) {
    const title = (r.job_title || '').trim().toLowerCase();
    // no title → nothing to collapse on; keep the row distinct by id
    const k = title ? `${normCompany(r.company)}\u0000${title}` : `id\u0000${r.id}`;
    if (seen.has(k)) continue;
    seen.add(k); out.push(r);
  }
  return out;
}

export function aggregate(rawRows, { querySkills = [], top = 12 } = {}) {
  const rows = dedupeRoles(rawRows);
  const n = rows.length, postings = rawRows.length;
  const skip = new Set(querySkills.map((s) => s.toLowerCase()));

  const skillCount = new Map();
  for (const r of rows) for (const s of new Set(r.technology_slugs || [])) if (!skip.has(s)) skillCount.set(s, (skillCount.get(s) || 0) + 1);
  const skills = [...skillCount].sort((a, b) => b[1] - a[1]).slice(0, top).map(([slug, c]) => ({ slug, count: c, share: c / n }));

  const bySen = new Map();
  for (const r of rows) { const s = salaryOf(r); if (s) { const k = r.seniority || 'unlabeled'; (bySen.get(k) || bySen.set(k, []).get(k)).push(s); } }
  const all = [...bySen.values()].flat();
  const salary = {
    parsed: all.length,
    overall: { p25: q(all, 0.25), p50: q(all, 0.5), p75: q(all, 0.75) },
    // only report a stratum with enough points to mean something
    bySeniority: [...bySen].filter(([, v]) => v.length >= 5).map(([k, v]) => ({ seniority: k, n: v.length, p25: q(v, 0.25), p50: q(v, 0.5), p75: q(v, 0.75) })).sort((a, b) => b.n - a.n),
  };

  const seniority = countBy(rows, (r) => r.seniority || 'unlabeled');
  const sources = countBy(rows, (r) => (r.sources || []).map((s) => s.provider), true);
  // "who is hiring" must not be topped by aggregators reposting employer roles
  const display = new Map();
  for (const r of rows) { const k = normCompany(r.company); if (k && !display.has(k)) display.set(k, r.company.trim()); }
  const employers = countBy(rows.filter((r) => !isReposter(r)), (r) => normCompany(r.company)).slice(0, 8).map((e) => ({ key: display.get(e.key) || e.key, count: e.count }));
  const remote = rows.filter((r) => r.remote === true).length;

  return { n, postings, skills, salary, seniority, sources, employers, remote };
}

function countBy(rows, keyFn, multi = false) {
  const m = new Map();
  for (const r of rows) for (const k of multi ? keyFn(r) : [keyFn(r)]) if (k) m.set(k, (m.get(k) || 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1]).map(([key, count]) => ({ key, count }));
}

// ── cv matching (pure) ───────────────────────────────────────────────────
// How people write it on a CV → the slug the API uses.
const ALIASES = {
  k8s: 'kubernetes', golang: 'go', postgres: 'postgresql', js: 'javascript', ts: 'typescript',
  node: 'nodejs', 'node.js': 'nodejs', reactjs: 'react', 'react.js': 'react', 'vue.js': 'vue',
  gcp: 'google-cloud', 'amazon web services': 'aws', llms: 'llm', 'ci/cd': 'ci-cd', 'c plus plus': 'c++',
};
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function matchCv(cvText, skills) {
  if (!cvText) return skills.map((s) => ({ ...s, have: null }));
  const text = cvText.toLowerCase();
  // the Skills section, if there is one — used for very short slugs (go, r, c)
  // where a whole-text match would hit ordinary prose
  const sec = /(^|\n)#+[^\n]*skills[^\n]*\n([\s\S]*?)(?=\n#+|\s*$)/i.exec(text);
  const skillsSection = sec ? sec[2] : '';
  return skills.map((s) => {
    const slug = s.slug.toLowerCase();
    const forms = new Set([slug, slug.replace(/-/g, ' '), slug.replace(/-/g, '')]);
    for (const [alias, target] of Object.entries(ALIASES)) if (target === slug) forms.add(alias);
    const hay = slug.length <= 2 ? skillsSection : text;
    const have = [...forms].some((f) => new RegExp(`(^|[^a-z0-9+#])${esc(f)}(?=$|[^a-z0-9+#])`, 'i').test(hay));
    return { ...s, have };
  });
}

// ── rendering ────────────────────────────────────────────────────────────
const usd = (v) => (v == null ? '—' : `$${Math.round(v).toLocaleString('en-US')}`);
const pct = (v) => `${(v * 100).toFixed(0)}%`;
const bar = (share, w = 24) => '█'.repeat(Math.round(share * w)).padEnd(w, '·');

export function renderText(a, o, total, cvUsed) {
  const L = [];
  const what = [...o.skills.map((s) => `skills:${s}`), ...o.titles.map((t) => `title:"${t}"`), ...o.countries, o.remote ? 'remote' : null].filter(Boolean).join(' · ');
  L.push(`MARKET BRIEF — ${what} — last ${o.days} days`);
  L.push(`  pool ${total ?? '?'} postings · sampled ${a.postings} → ${a.n} unique roles (newest first, not a random sample) · remote ${a.remote}/${a.n}`);
  L.push('');
  L.push(`  mentioned alongside, share of unique roles${cvUsed ? '   [✓ in your cv.md  ✗ not found]' : ''}`);
  for (const s of a.skills) {
    const mark = s.have === null ? ' ' : s.have ? '✓' : '✗';
    L.push(`  ${mark} ${s.slug.padEnd(18)} ${pct(s.share).padStart(4)}  ${bar(s.share)}`);
  }
  if (cvUsed) {
    const gap = a.skills.filter((s) => s.have === false);
    L.push('');
    L.push(`  in cv.md: ${a.skills.filter((s) => s.have).length}/${a.skills.length} of the top ${a.skills.length}`);
    if (gap.length) L.push(`  not found, by demand: ${gap.map((s) => `${s.slug} (${pct(s.share)})`).join('  ')}`);
  }
  L.push('');
  L.push(`  salary, USD, parsed on ${a.salary.parsed}/${a.n} roles`);
  L.push(`    all         P25 ${usd(a.salary.overall.p25)}   P50 ${usd(a.salary.overall.p50)}   P75 ${usd(a.salary.overall.p75)}`);
  for (const s of a.salary.bySeniority) L.push(`    ${s.seniority.padEnd(11)} P25 ${usd(s.p25)}   P50 ${usd(s.p50)}   P75 ${usd(s.p75)}   (n=${s.n})`);
  L.push('');
  L.push(`  seniority: ${a.seniority.map((s) => `${s.key} ${s.count}`).join(' · ')}`);
  L.push(`  sources:   ${a.sources.slice(0, 6).map((s) => `${s.key} ${s.count}`).join(' · ')}`);
  if (a.employers.length) L.push(`  hiring:    ${a.employers.slice(0, 6).map((e) => `${e.key} (${e.count})`).join(', ')}   (reposting platforms excluded)`);
  L.push('');
  L.push('  read this as "what postings mention", not "what you must learn" — postings are wishlists.');
  return L.join('\n');
}

export function renderMarkdown(a, o, total, cvUsed) {
  const what = [...o.skills.map((s) => `\`${s}\``), ...o.titles.map((t) => `"${t}"`), ...o.countries, o.remote ? 'remote' : null].filter(Boolean).join(' · ');
  const L = [`# Market brief — ${what}`, '', `Last ${o.days} days · pool **${total ?? '?'}** postings · sampled **${a.postings}** → **${a.n}** unique roles (newest first) · generated ${new Date().toISOString().slice(0, 10)}`, ''];
  L.push(`## Mentioned alongside`, '', `| skill | share | ${cvUsed ? 'in cv.md |' : ''}`, `|---|---:|${cvUsed ? '---|' : ''}`);
  for (const s of a.skills) L.push(`| ${s.slug} | ${pct(s.share)} | ${cvUsed ? (s.have ? '✓' : '✗') + ' |' : ''}`);
  L.push('', `## Salary (USD, parsed on ${a.salary.parsed}/${a.n})`, '', `| level | n | P25 | P50 | P75 |`, `|---|---:|---:|---:|---:|`);
  L.push(`| all | ${a.salary.parsed} | ${usd(a.salary.overall.p25)} | ${usd(a.salary.overall.p50)} | ${usd(a.salary.overall.p75)} |`);
  for (const s of a.salary.bySeniority) L.push(`| ${s.seniority} | ${s.n} | ${usd(s.p25)} | ${usd(s.p50)} | ${usd(s.p75)} |`);
  L.push('', `**Seniority:** ${a.seniority.map((s) => `${s.key} ${s.count}`).join(' · ')}  `, `**Sources:** ${a.sources.slice(0, 6).map((s) => `${s.key} ${s.count}`).join(' · ')}  `);
  if (a.employers.length) L.push(`**Hiring (reposting platforms excluded):** ${a.employers.slice(0, 6).map((e) => `${e.key} (${e.count})`).join(', ')}`);
  L.push('', '> Read as *what postings mention*, not *what you must learn* — postings are wishlists. Sample is the newest N of the pool, not a random draw.');
  return L.join('\n') + '\n';
}

export function renderSvg(a, o, cvUsed) {
  const W = 720, rowH = 26, left = 150, top = 56, barW = W - left - 90;
  const H = top + a.skills.length * rowH + 40;
  const what = [...o.skills, ...o.titles, o.remote ? 'remote' : null].filter(Boolean).join(' · ');
  const x = (s) => `${s}`.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  const rows = a.skills.map((s, i) => {
    const y = top + i * rowH, w = Math.max(2, Math.round(s.share * barW));
    const fill = s.have === null ? '#4f7cac' : s.have ? '#2e8b57' : '#c9793a';
    return `<text x="${left - 8}" y="${y + 17}" text-anchor="end" font-size="13">${x(s.slug)}</text>
<rect x="${left}" y="${y + 4}" width="${w}" height="${rowH - 8}" rx="3" fill="${fill}"/>
<text x="${left + w + 6}" y="${y + 17}" font-size="12" fill="#333">${pct(s.share)}</text>`;
  }).join('\n');
  const legend = cvUsed ? `<text x="${W - 10}" y="40" text-anchor="end" font-size="11" fill="#555"><tspan fill="#2e8b57">■</tspan> in cv.md   <tspan fill="#c9793a">■</tspan> not found</text>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" font-family="system-ui,-apple-system,Segoe UI,Roboto,sans-serif">
<rect width="100%" height="100%" fill="#fff"/>
<text x="12" y="24" font-size="16" font-weight="600">What ${x(what)} postings mention — last ${o.days} days</text>
<text x="12" y="42" font-size="11" fill="#555">share of ${a.n} unique roles from ${a.postings} postings (pool of ${a.total ?? '?'}) · salary P50 ${usd(a.salary.overall.p50)} on ${a.salary.parsed} parsed</text>
${legend}
${rows}
<text x="12" y="${H - 12}" font-size="10" fill="#777">source: JobsPipe · postings are wishlists — read as "mentioned", not "required"</text>
</svg>
`;
}

// ── main ─────────────────────────────────────────────────────────────────
async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.help) { console.log(USAGE); return; }
  const here = path.dirname(fileURLToPath(import.meta.url));
  const root = findRoot(here);
  const env = { ...readDotEnv(path.join(root, '.env')), ...process.env };
  const apiKey = env.JOBSPIPE_API_KEY;
  if (!apiKey) throw new Error(`JOBSPIPE_API_KEY not set — add it to ${path.join(root, '.env')}`);

  console.error(`→ up to ${o.sample} postings = up to ${o.sample} credits (one credit per job returned)`);
  const { rows, total } = await fetchSample(apiKey, o);
  if (!rows.length) { console.log('no postings matched — widen --days or drop a filter'); return; }

  const cvPath = o.cv ? path.resolve(o.cv) : path.join(root, 'cv.md');
  const cvText = existsSync(cvPath) ? readFileSync(cvPath, 'utf8') : '';
  const a = aggregate(rows, { querySkills: o.skills, top: o.top });
  a.skills = matchCv(cvText, a.skills);
  a.total = total;
  const cvUsed = Boolean(cvText);

  if (o.json) console.log(JSON.stringify({ query: o, total, ...a }, null, 2));
  else console.log(renderText(a, o, total, cvUsed));
  if (o.md) { writeFileSync(o.md, renderMarkdown(a, o, total, cvUsed)); console.error(`→ wrote ${o.md}`); }
  if (o.svg) { writeFileSync(o.svg, renderSvg(a, o, cvUsed)); console.error(`→ wrote ${o.svg}`); }
  if (!cvUsed) console.error(`→ no cv.md at ${cvPath}; pass --cv to compare against yours`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(`brief: ${e.message}`); process.exit(1); });
}
