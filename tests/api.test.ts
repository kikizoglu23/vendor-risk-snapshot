/**
 * API tests against a running server and LIVE data sources.
 *   API_BASE=http://localhost:3000 npm run test:api
 *
 * "Ground truth" cases use facts that are public and will not change:
 * the 2013 Adobe breach, Google's DMARC policy, a ransomware.live record
 * that previously produced a false positive, and confirmed 2026 victims.
 */
import { describe, expect, it } from "vitest";

const BASE = process.env.API_BASE ?? "http://localhost:3000";
const IDS = ["ransomware", "breaches", "exposed-services", "email-security"];
const STATUSES = ["pass", "warn", "fail", "error"];
const SEVERITIES = ["info", "low", "medium", "high", "critical"];
const NX = "this-domain-does-not-exist-vrs-test.com";

async function get(path: string) {
  const res = await fetch(BASE + path);
  return {
    status: res.status,
    cache: res.headers.get("cache-control") ?? "",
    /** Set only on Vercel: HIT / MISS / STALE from its CDN cache. */
    vercelCache: res.headers.get("x-vercel-cache"),
    type: res.headers.get("content-type") ?? "",
    body: await res.json(),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function expectValidResult(r: any, checkId: string, domain: string) {
  expect(r.checkId).toBe(checkId);
  expect(r.domain).toBe(domain);
  expect(STATUSES).toContain(r.status);
  if (r.status === "error") expect(r.score).toBeNull();
  else {
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(100);
  }
  expect(typeof r.summary).toBe("string");
  expect(r.summary.length).toBeGreaterThan(5);
  expect(Array.isArray(r.findings)).toBe(true);
  for (const f of r.findings) {
    expect(SEVERITIES).toContain(f.severity);
    expect(typeof f.title).toBe("string");
    if (f.link) expect(f.link).toMatch(/^https:\/\//);
  }
  expect(Array.isArray(r.followUps)).toBe(true);
  for (const q of r.followUps) {
    expect(["critical", "high", "medium", "low"]).toContain(q.priority);
    expect(q.question).toMatch(/\?$/);
    if (q.evidence) expect(q.evidence).toMatch(/^https:\/\//);
  }
  if (r.status === "error") expect(r.followUps).toEqual([]);
  expect(r.durationMs).toBeGreaterThanOrEqual(0);
  expect(Date.parse(r.checkedAt)).not.toBeNaN();
}

describe("GET /api/checks", () => {
  it("lists the 4 checks with public metadata only", async () => {
    const { status, body, type } = await get("/api/checks");
    expect(status).toBe(200);
    expect(type).toContain("application/json");
    expect(body.checks.map((c: { id: string }) => c.id)).toEqual(IDS);
    for (const c of body.checks) {
      expect(Object.keys(c).sort()).toEqual(["id", "limitations", "name", "question", "shortName", "sources", "weight", "whyItMatters"]);
    }
  });
});

describe("GET /api/checks/{id} — every check, every input class", () => {
  for (const id of IDS) {
    describe(id, () => {
      it("returns a valid, cacheable result for a real domain", async () => {
        const path = `/api/checks/${id}?domain=adobe.com`;
        const { status, body, cache, vercelCache } = await get(path);
        expect(status).toBe(200);
        expectValidResult(body, id, "adobe.com");
        expect(body.status).not.toBe("error");
        if (vercelCache === null) {
          expect(cache).toContain("s-maxage=3600"); // local server: header is passed through
        } else {
          // Vercel's CDN consumes s-maxage, so prove caching by asking twice
          const again = await get(path);
          expect(["HIT", "STALE"]).toContain(again.vercelCache);
        }
      });

      it("normalises messy input (URL, uppercase, www, path, email)", async () => {
        const a = await get(`/api/checks/${id}?domain=${encodeURIComponent("HTTPS://www.Adobe.com/about?x=1")}`);
        const b = await get(`/api/checks/${id}?domain=${encodeURIComponent("jane@adobe.com")}`);
        expect(a.body.domain).toBe("adobe.com");
        expect(b.body.domain).toBe("adobe.com");
      });

      it("reports a non-existent domain as an error and does not cache it", async () => {
        const { status, body, cache } = await get(`/api/checks/${id}?domain=${NX}`);
        expect(status).toBe(200);
        expectValidResult(body, id, NX);
        expect(body.status).toBe("error");
        expect(body.summary).toContain("does not exist");
        expect(cache).toBe("no-store");
      });

      it("rejects invalid and missing domains with 400", async () => {
        for (const q of ["?domain=not_a_domain", "?domain=", "", "?domain=localhost", "?domain=10.0.0.1", "?domain=%3Cscript%3E"]) {
          const { status, body } = await get(`/api/checks/${id}${q}`);
          expect(status, q).toBe(400);
          expect(body.error).toMatch(/valid domain/);
        }
      });
    });
  }

  it("returns 404 for an unknown check id", async () => {
    const { status, body } = await get("/api/checks/does-not-exist?domain=adobe.com");
    expect(status).toBe(404);
    expect(body.error).toContain("Unknown check");
  });
});

describe("GET /api/scan", () => {
  it("runs all checks and returns the overall score", async () => {
    const { status, body } = await get("/api/scan?domain=adobe.com");
    expect(status).toBe(200);
    expect(body.domain).toBe("adobe.com");
    expect(body.results.map((r: { checkId: string }) => r.checkId)).toEqual(IDS);
    body.results.forEach((r: { checkId: string }) => expectValidResult(r, r.checkId, "adobe.com"));
    expect(body.overall.score).toBeGreaterThanOrEqual(0);
    expect(["A", "B", "C", "D", "F"]).toContain(body.overall.grade);
    expect(body.overall.scoredChecks).toBe(4);
  });

  it("returns the merged, prioritised questions for the vendor", async () => {
    const { body } = await get("/api/scan?domain=skyplan.com");
    const order = { critical: 0, high: 1, medium: 2, low: 3 } as Record<string, number>;
    const priorities = body.followUps.map((f: { priority: string }) => order[f.priority]);
    expect(priorities).toEqual([...priorities].sort((a: number, b: number) => a - b));
    expect(body.followUps[0].priority).toBe("critical");
    expect(body.followUps[0].question).toContain("thegentlemen");
    const all = body.results.flatMap((r: { followUps: unknown[] }) => r.followUps);
    expect(body.followUps.length).toBe(new Set(all.map((f: { question: string }) => f.question)).size);
  });

  it("gives no grade to a domain that does not exist", async () => {
    const { body, cache } = await get(`/api/scan?domain=${NX}`);
    expect(body.overall).toEqual({ score: null, grade: null, capped: false, scoredChecks: 0 });
    expect(body.followUps).toEqual([]);
    expect(cache).toBe("no-store");
  });

  it("rejects invalid input with 400", async () => {
    expect((await get("/api/scan?domain=nope")).status).toBe(400);
    expect((await get("/api/scan")).status).toBe(400);
  });
});

describe("ground truth with live data", () => {
  it("breaches: finds the 2013 Adobe breach", async () => {
    const { body } = await get("/api/checks/breaches?domain=adobe.com");
    expect(body.status).toBe("warn");
    expect(body.data.breaches.some((b: { date: string }) => b.date === "2013-10-04")).toBe(true);
    expect(body.followUps[0].question).toContain("2013-10-04");
    expect(body.followUps[0].evidence).toMatch(/^https:\/\/haveibeenpwned\.com\//);
  });

  it("email-security: google.com publishes DMARC p=reject", async () => {
    const { body } = await get("/api/checks/email-security?domain=google.com");
    expect(body.data.dmarcPoints).toBe(60);
    expect(body.status).toBe("pass");
    expect(body.followUps).toEqual([]); // nothing to ask a vendor with p=reject
  });

  it("email-security: subdomain without its own records is scored on what it publishes", async () => {
    const { body } = await get("/api/checks/email-security?domain=example.com");
    expectValidResult(body, "email-security", "example.com");
  });

  it("ransomware: linkedin.com is NOT matched to a victim whose LinkedIn page was listed", async () => {
    const { body } = await get("/api/checks/ransomware?domain=linkedin.com");
    const names: string[] = body.data.listings.map((l: { name: string }) => l.name);
    expect(names.some((n) => n.includes("SAGAM"))).toBe(false);
  });

  it("ransomware: a confirmed 2026 victim is flagged critical with an evidence link", async () => {
    const { body } = await get("/api/checks/ransomware?domain=skyplan.com");
    expect(body.status).toBe("fail");
    expect(body.score).toBe(0);
    expect(body.findings[0].severity).toBe("critical");
    expect(body.findings[0].link).toMatch(/^https:\/\/www\.ransomware\.live\//);
  });

  it("scoring: a recent ransomware victim can never score above the critical cap", async () => {
    for (const d of ["stephensprecision.com", "translarity.com", "pacomposite.com"]) {
      const { body } = await get(`/api/scan?domain=${d}`);
      expect(body.overall.score, d).toBeLessThanOrEqual(49);
    }
  });

  it("exposed-services: KEV hits are a subset of the CVEs found, with NVD links", async () => {
    const { body } = await get("/api/checks/exposed-services?domain=skyplan.com");
    expectValidResult(body, "exposed-services", "skyplan.com");
    for (const k of body.data.kev) expect(body.data.cves).toContain(k);
    for (const f of body.findings.filter((x: { severity: string }) => x.severity === "critical")) {
      expect(f.link).toMatch(/^https:\/\/nvd\.nist\.gov\/vuln\/detail\/CVE-/);
      expect(f.related.url).toMatch(/^https:\/\/socradar\.io\/free-tools\/cve-radar\/CVE-\d{4}-\d+$/);
    }
    expect(body.followUps.filter((q: { priority: string }) => q.priority === "critical")).toHaveLength(Math.min(5, body.data.kev.length));
  });
});

describe("load", () => {
  it("handles 10 vendors × 4 checks (40 parallel requests) without errors", async () => {
    const domains = ["adobe.com", "google.com", "dropbox.com", "canva.com", "okta.com", "github.com", "slack.com", "zoom.us", "atlassian.com", "salesforce.com"];
    const started = Date.now();
    const all = await Promise.all(domains.flatMap((d) => IDS.map((id) => get(`/api/checks/${id}?domain=${d}`))));
    const errors = all.filter((r) => r.status !== 200 || r.body.status === "error").map((r) => `${r.body.domain}/${r.body.checkId}: ${r.body.summary}`);
    expect(errors).toEqual([]);
    console.log(`40 requests in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  }, 120_000);
});
