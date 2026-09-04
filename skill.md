---
name: career-ops-plugin-jobspipe
description: How to configure and use the JobsPipe job search provider in career-ops.
license: MIT
---

# career-ops-plugin-jobspipe

> This file teaches an AI agent how to use this plugin. It must not instruct
> the agent to edit core career-ops files, change scoring, or act outside the
> plugin's declared hooks.

## What it does

Adds a `provider` hook that queries the [JobsPipe](https://jobspipe.dev) API —
live postings from 30+ ATS and job-board sources (Workday, Greenhouse, Lever,
Ashby, Workable, SmartRecruiters, iCIMS, JazzHR, Teamtailor and more),
**deduplicated into one schema**, so a role cross-posted to four boards arrives
once instead of four times. Results are structured, so downstream CV evaluation
never parses HTML.

## How to enable it

1. Get a key at <https://jobspipe.dev/signup> and add it to your `.env`:

```env
JOBSPIPE_API_KEY=jp_live_your_key_here
```

2. Enable and consent:

```bash
node plugins.mjs enable jobspipe
node plugins.mjs enable jobspipe --confirm
```

## portals.yml configuration

### Simple query (scan_query is used as the job title filter)

```yaml
tracked_companies:
  - name: "Platform engineering roles"
    provider: jobspipe
    scan_query: "Platform Engineer"
```

### Full jobspipe config block (all keys optional)

```yaml
tracked_companies:
  - name: "Remote senior Rust roles"
    provider: jobspipe
    jobspipe:
      job_title_or:
        - "Backend Engineer"
        - "Systems Engineer"
      skills_or: ["rust", "kubernetes"]
      job_country_code_or: ["US", "GB", "DE"]
      job_seniority_or: ["senior"]
      remote: true
      posted_at_max_age_days: 7
      limit: 25
```

### Search by skill with no job title

`skills_or` alone is a valid search — useful when a technology matters more
than what the role is called:

```yaml
  - name: "Anything Rust"
    provider: jobspipe
    jobspipe:
      skills_or: ["rust"]
```

## Config reference

| Key | Type | Default | Description |
|---|---|---|---|
| `job_title_or` | `string[]` | — | Job titles (OR logic). Overrides `scan_query`. |
| `job_title_not` | `string[]` | — | Exclude titles containing these. |
| `skills_or` | `string[]` | — | Technologies/skills, e.g. `["rust","postgres"]`. |
| `description_or` | `string[]` | — | Match text in the job description. |
| `job_country_code_or` | `string[]` | — | ISO-2 country codes. Omit for global. |
| `job_location_or` | `string[]` | — | Location strings. |
| `job_seniority_or` | `string[]` | — | e.g. `["mid","senior"]`. |
| `employment_type_or` | `string[]` | — | `full-time`, `contract`, `internship`, … |
| `work_arrangement_or` | `string[]` | — | `remote`, `hybrid`, `onsite`. |
| `company_name_or` | `string[]` | — | Restrict to named companies. |
| `source_or` / `source_not` | `string[]` | — | Include/exclude specific ATS sources. |
| `remote` | `boolean` | — | `true` = remote only. Omit to include both. |
| `posted_at_max_age_days` | `number` | `14` | Max posting age in days. |
| `posted_at_gte` | `string` | — | `YYYY-MM-DD` lower bound. |
| `limit` | `number` | `25` | Results per request. |
| `offset` | `number` | — | Pagination offset. |

### A note on `limit`

`limit` is capped by your JobsPipe plan — **free 25, builder 100, scale 500**.
Setting a higher number than your plan allows does not error; you simply get
your plan's maximum. One credit is one job **returned**, not one request, so a
25-result scan costs 25 credits against the monthly quota.

## What it produces

Each result maps to a `Job` record:

| Field | Source |
|---|---|
| `title` | `job_title` |
| `url` | `final_url` (JobsPipe resolves redirects server-side; there is no `url` field) |
| `company` | `company` (object shape tolerated, degrades to `.name`) |
| `location` | `location` |

## Troubleshooting

| Error | Meaning |
|---|---|
| `401` | `JOBSPIPE_API_KEY` missing or invalid — keys look like `jp_live_...` |
| `402` | This key has used its monthly job allowance; it resets next cycle |
| `429` | Per-second rate limit — reduce concurrent scans |
