# Vendor Risk Snapshot

A free, passive third-party risk check. Paste up to 10 supplier domains and get an
evidence-backed snapshot of each vendor's public security posture from open
threat-intelligence sources — plus the exact questions to send each vendor,
ready to paste into an email. No signup, no API keys, nothing stored.

## Checks

| Check | Question | Data source | Weight |
|---|---|---|---|
| `ransomware` | Listed as a victim on a ransomware leak site? | ransomware.live + SOCRadar Ransomware Intelligence | 35 |
| `breaches` | Publicly disclosed data breaches? | Have I Been Pwned | 20 |
| `exposed-services` | Risky open ports or known-exploited CVEs on public servers? | Shodan InternetDB + CISA KEV + FIRST EPSS | 25 |
| `email-security` | Protected against email spoofing (SPF + DMARC)? | DNS-over-HTTPS (Cloudflare, Google) | 20 |

## Architecture

```
Browser (Scanner.tsx)
   │  runs every check × every domain in parallel, renders results as they arrive
   ▼
/api/checks/{id}?domain=…        ← one independent endpoint per check
   │
   ▼
runner.ts  — timeout + error isolation (one broken source never breaks the report)
   │
   ▼
checks/{id}.ts  — each check: query sources → findings → score 0-100
   │
   ▼
scoring.ts — weighted average, capped at 49 if any critical finding, A–F grade
```

```
src/
  app/
    page.tsx                  landing page + methodology (generated from the registry)
    api/checks/route.ts       GET  /api/checks            list checks
    api/checks/[id]/route.ts  GET  /api/checks/{id}       run one check
    api/scan/route.ts         GET  /api/scan              run all + overall score
  components/Scanner.tsx      input, results table, CSV/PDF export, share links
  lib/
    checks/types.ts           the CheckDefinition contract
    checks/registry.ts        the list of active checks
    checks/runner.ts          safe execution wrapper
    checks/*.ts               one file per check
    sources/                  shared clients: DNS, CISA KEV (cached 6h), EPSS
    scoring.ts                overall score & grade
    domain.ts                 input normalisation
```

## Questions for the vendor

Each check can define an optional `followUps(outcome)` function that turns its findings
into questions (e.g. a recent ransomware listing → "Were systems or data related to our
engagement affected?"). `src/lib/questionnaire.ts` merges them across checks, ranks them
by priority (critical → low), removes duplicates and builds a ready-to-send email.
They appear in the UI ("Copy as email"), the PDF, the CSV and `/api/scan`.

Exploited CVEs also link to their page on SOCRadar CVE Radar for deeper investigation.

## SOCRadar integration

**Second ransomware source.** The ransomware check queries ransomware.live and SOCRadar's
Ransomware Intelligence search (`/free-tools/api/ransomware-intelligence/search?q=…&days=1825`)
in parallel. The same strict matching rules apply to both (SOCRadar's search is fuzzy, e.g.
`att.com` also returns `hyatt.com`). An incident reported by both is merged (group names
normalised, dates within 3 days) and labelled "seen by 2 independent sources". Listings that
name another organisation as well (`verveba.com \ www.att.com`) are flagged as a possible
supplier/partner incident and produce a follow-up question.

This is the endpoint behind SOCRadar's free tool, not a documented public API, and SOCRadar's
free tools share a daily limit protected by a human check. The client sends plain, low-volume
requests only (no tokens), never retries on a limit, pauses for 15 minutes after one, caches for
an hour, and the check falls back to ransomware.live alone when SOCRadar is unavailable.

**Hand-off links.** SOCRadar tools that sit behind a human check (Dark Web Report, External
Attack Surface) are not queried. Each vendor report links to them with the domain pre-filled,
so the check runs in the user's own browser.

## Referral loop and attribution

The email draft includes a link to the vendor's own report (`?d=vendor.com&utm_source=vendor-email…`).
A vendor arriving through it sees what its customer saw, plus a "monitor continuously" CTA.
All CTAs carry UTM tags (`utm_source=vendor-risk-snapshot`, campaign `homepage` or `vendor-loop`)
so sign-ups can be attributed to the tool and the channel. Tags are stripped from the address bar
after load, so share links stay clean.

## Resilience

- **Error isolation** — each check runs in its own request with a 25 s timeout; a failing
  data source shows "Unavailable" for that check only, and the score uses the rest.
- **Retries** — rate limits (429) and temporary errors (502/503/504) are retried twice with backoff.
- **Caching** — ransomware.live and Shodan lookups are cached in memory for 1 h, CISA KEV for 6 h,
  and successful API responses are cached at the edge for 1 h.
- **Typo guard** — a domain that doesn't exist in DNS gets no grade instead of a false "A".
- **Retry button** — the UI can re-run only the checks that failed.

## Adding a new check

1. Create `src/lib/checks/my-check.ts` exporting a `CheckDefinition`
   (`id`, `name`, `shortName`, `question`, `whyItMatters`, `weight`, `sources`, `limitations`, `run`,
   and optionally `followUps`).
2. Add it to the array in `src/lib/checks/registry.ts`.

That's it — the endpoint `/api/checks/my-check`, the UI column, the methodology
section and the overall score all pick it up automatically.

## Tests

```bash
npm test                                         # 125 unit tests (matching, SOCRadar merge, scoring, SPF/DMARC, runner, questions, links)
API_BASE=http://localhost:3000 npm run test:api  # 32 API tests against live data sources
APP_URL=http://localhost:3000 npm run test:e2e   # 29 browser tests (Playwright)
```

## Run locally

```bash
npm install
npm run dev   # http://localhost:3000
```

## Deploy

Push to GitHub and import the repo on [Vercel](https://vercel.com/new) — no
environment variables needed.
