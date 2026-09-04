// @ts-check
// career-ops-plugin-jobspipe — normalized job data via the JobsPipe API.
//
// JobsPipe returns postings from 30+ ATS and job-board sources (Workday,
// Greenhouse, Lever, Ashby, Workable, SmartRecruiters, iCIMS, JazzHR,
// Teamtailor and more) deduplicated into one schema, so the same role that
// appears on four boards arrives once. Results are structured — parsed salary
// ranges, seniority, and technology slugs — which keeps downstream CV
// evaluation off raw HTML.
//
// Wire in via a portals.yml entry with `provider: jobspipe` and either a
// `scan_query` / `query` (used as job_title_or[0]) or a full `jobspipe:` block
// for multi-title / skill / country / seniority filters (see skill.md).
//
// IMPORTANT: Route all HTTP through ctx.fetchJson so the manifest
// allowedHosts guard actually runs — do NOT call global fetch.

const API_URL = 'https://api.jobspipe.dev/v1/jobs/search';

// Filters copied straight through to the API when present in the entry's
// `jobspipe:` block. A list beats a dozen if-blocks, and adding a filter
// JobsPipe ships later is a one-word change here.
const PASSTHROUGH_FILTERS = [
  'job_title_not',
  'description_or',
  'skills_or',
  'job_country_code_or',
  'job_location_or',
  'job_seniority_or',
  'employment_type_or',
  'work_arrangement_or',
  'company_name_or',
  'source_or',
  'source_not',
  'posted_at_gte',
  'offset',
];

/**
 * Map one JobsPipe record to the career-ops Job shape.
 * Exported for tests; the engine only ever calls provider.fetch.
 * @param {any} j
 * @param {string} [fallbackName]
 */
export function mapJob(j, fallbackName = '') {
  return {
    title: j.job_title || '',
    // Link field, in priority order. The live API returns `url` (and an
    // identical `source_url`); `final_url` is what the sandbox and the public
    // docs return, and it is null on every live record. Reading only one of
    // them yields zero jobs against the other, so read all of them.
    url: j.url || j.final_url || j.source_url || j.sources?.[0]?.url || '',
    // Live records carry both a `company` string and a `company_object`.
    company:
      (typeof j.company === 'string' ? j.company : j.company?.name) ||
      j.company_object?.name ||
      fallbackName ||
      '',
    location: j.location || j.short_location || j.long_location || '',
  };
}

/** @type {any} */
export default {
  provider: {
    id: 'jobspipe',

    detect(entry) {
      if (entry.scan_method === 'jobspipe' || entry.provider === 'jobspipe') {
        return { url: 'jobspipe' };
      }
      return null;
    },

    /**
     * Fetch jobs from JobsPipe POST /v1/jobs/search.
     * Returns Job[] = { title, url, company, location }.
     *
     * Supported portals.yml config under the `jobspipe:` key (all optional):
     *   job_title_or:           [string]  — searched titles (overrides query)
     *   skills_or:              [string]  — e.g. ["rust","kubernetes"]
     *   job_country_code_or:    [string]  — ISO-2, e.g. ["US","GB"]
     *   job_seniority_or:       [string]  — e.g. ["mid","senior"]
     *   work_arrangement_or:    [string]  — remote | hybrid | onsite
     *   employment_type_or:     [string]  — full-time | contract | ...
     *   remote:                 boolean   — true = remote-only
     *   posted_at_max_age_days: number    — default 14
     *   limit:                  number    — default 25
     *
     * @param {{ name?: string, scan_query?: string, query?: string, jobspipe?: any }} entry
     * @param {{ fetchJson: Function, env: Record<string,string>, log?: any }} ctx
     */
    async ["fetch"](entry, ctx) {
      const apiKey = ctx.env?.JOBSPIPE_API_KEY || process.env.JOBSPIPE_API_KEY;
      if (!apiKey) {
        throw new Error(
          'JOBSPIPE_API_KEY is not set — add it to .env and enable jobspipe in config/plugins.yml',
        );
      }

      const cfg = entry.jobspipe || {};

      const titles =
        Array.isArray(cfg.job_title_or) && cfg.job_title_or.length
          ? cfg.job_title_or
          : entry.scan_query || entry.query
            ? [entry.scan_query || entry.query]
            : null;

      // A skills-only search is legitimate (every Rust role, whatever it is
      // called), so only demand a title when no skills filter is set either.
      const hasSkills = Array.isArray(cfg.skills_or) && cfg.skills_or.length > 0;
      if (!titles && !hasSkills) {
        throw new Error(
          `jobspipe: entry "${entry.name}" is missing query, scan_query, jobspipe.job_title_or, or jobspipe.skills_or`,
        );
      }

      const payload = {
        posted_at_max_age_days: cfg.posted_at_max_age_days ?? 14,
        limit: cfg.limit ?? 25,
      };
      if (titles) payload.job_title_or = titles;
      if (typeof cfg.remote === 'boolean') payload.remote = cfg.remote;
      for (const key of PASSTHROUGH_FILTERS) {
        const v = cfg[key];
        if (v === undefined || v === null) continue;
        if (Array.isArray(v) && v.length === 0) continue; // empty arrays are rejected upstream
        payload[key] = v;
      }

      let json;
      try {
        json = await ctx.fetchJson(API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify(payload),
        });
      } catch (err) {
        // Turn JobsPipe's documented status codes into something a user can
        // act on. Without this they get a bare "HTTP 402" in the scan log and
        // no idea that their monthly job quota is simply spent.
        const status = err?.status;
        if (status === 401) {
          throw new Error('jobspipe: 401 — JOBSPIPE_API_KEY is missing or invalid (keys look like jp_live_...)');
        }
        if (status === 402) {
          throw new Error('jobspipe: 402 — monthly job quota exhausted; see https://jobspipe.dev/pricing');
        }
        if (status === 429) {
          const retry = err?.retryAfter ? ` (retry after ${err.retryAfter}s)` : '';
          throw new Error(`jobspipe: 429 — per-second rate limit hit${retry}; reduce concurrent scans`);
        }
        throw err;
      }

      const jobs = Array.isArray(json?.data) ? json.data : [];
      return jobs.map((j) => mapJob(j, entry.name)).filter((j) => j.title && j.url);
    },
  },
};
