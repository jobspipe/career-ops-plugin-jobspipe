# career-ops-plugin-jobspipe

A community plugin for [career-ops](https://github.com/career-ops-hq/career-ops).

## What it does

Adds a **structured job search provider** via the [JobsPipe](https://jobspipe.dev)
API — live postings from 30+ ATS and job-board sources (Workday, Greenhouse,
Lever, Ashby, Workable, SmartRecruiters, iCIMS, JazzHR, Teamtailor and more),
deduplicated into a single schema.

Key features:

- **Cross-source dedup** — a role posted to four boards arrives once, not four times
- Filter by title, skill, country, seniority, employment type and work arrangement
- `skills_or` works without a title, for "any Rust role, whatever it's called"
- Structured fields (parsed salary, seniority, technology slugs) mean no HTML parsing downstream
- Actionable errors for JobsPipe's documented `401` / `402` / `429` responses

Per career-ops's zero-keys-in-the-open-core policy, keyed integrations live in
the plugin layer — this plugin is opt-in and inert until you enable it and
supply a key.

## Install

```bash
node plugins.mjs add jobspipe
node plugins.mjs enable jobspipe --confirm
```

Add your key to `.env`:

```env
JOBSPIPE_API_KEY=jp_live_your_key_here
```

Get one free at <https://jobspipe.dev/signup> (free tier: 1,000 jobs/month).

Then add an entry to `portals.yml`:

```yaml
tracked_companies:
  - name: "Remote senior Rust roles"
    provider: jobspipe
    jobspipe:
      skills_or: ["rust"]
      job_seniority_or: ["senior"]
      remote: true
```

Full configuration reference: [`skill.md`](./skill.md).

## Market brief

Beyond feeding the scanner, the plugin ships a standalone helper that answers
a different question: **what do live postings in my niche mention, what do
they pay, and where does my `cv.md` fall short?**

```bash
node plugins.local/jobspipe/_brief.mjs --skill rust --remote
node plugins.local/jobspipe/_brief.mjs --title "platform engineer" --country US --days 7
node plugins.local/jobspipe/_brief.mjs --skill rust --md brief.md --svg brief.svg
```

It samples the newest postings matching your filters (default 100), then reports:

- the skills mentioned alongside yours, as a share of postings, each marked
  ✓ / ✗ against your `cv.md` (aliases like `k8s` → `kubernetes` are handled)
- salary P25 / P50 / P75, overall **and per seniority level**, from postings
  that carry a parsed range
- seniority mix, which boards the roles came from, and which employers are
  hiring — aggregators are excluded from that last list so it stays honest
- `--md` writes a Markdown report, `--svg` writes a bar chart you can drop
  into a post

Nothing but the search filters leaves your machine; `cv.md` is read locally
for the comparison. One credit is one job returned, so `--sample 100` costs
100 credits — the script says so before it spends them.

Two things to read it correctly: **postings are wishlists**, so a skill's
share means "mentioned", not "required"; and the sample is the newest N of
the pool, not a random draw, so don't quote it as a market-wide census.

## Tests

```bash
node test/smoke.mjs         # zero-network: hooks match the manifest
node test/live-sandbox.mjs  # live: maps a real JobsPipe response, no API key needed
node test/brief.mjs         # zero-network: market-brief aggregation, cv matching, renderers
```

`live-sandbox.mjs` runs against JobsPipe's public sandbox endpoint, so it
verifies the payload the plugin builds and the field mapping it performs
against a genuine response envelope — an upstream field rename fails the test
instead of silently returning zero jobs in a user's scan.

## Disclosure

This plugin is maintained by the JobsPipe team. JobsPipe is a commercial API
with a free tier; this plugin is MIT-licensed and contains no telemetry,
tracking, or monetization surface.

## License

MIT
