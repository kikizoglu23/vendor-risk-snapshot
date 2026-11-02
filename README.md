# Vendor Risk Snapshot

A free, passive third-party risk check. Paste up to 10 supplier domains and get an
evidence-backed snapshot of each vendor's public security posture from open
threat-intelligence sources — plus the exact questions to send each vendor,
ready to paste into an email. No signup, no API keys, nothing stored.

## Checks

| Check | Question | Data source | Weight |
|---|---|---|---|
| `ransomware` | Listed as a victim on a ransomware leak site? | ransomware.live | 35 |
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
npm test                                         # 102 unit tests (matching, scoring, SPF/DMARC, runner, questions)
API_BASE=http://localhost:3000 npm run test:api  # 30 API tests against live data sources
APP_URL=http://localhost:3000 npm run test:e2e   # 25 browser tests (Playwright)
```

## Run locally

```bash
npm install
npm run dev   # http://localhost:3000
```

## Deploy

Push to GitHub and import the repo on [Vercel](https://vercel.com/new) — no
environment variables needed.
