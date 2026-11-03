/**
 * Follow-up questions: each check's generator (pure functions of the outcome)
 * and the questionnaire that merges them into a prioritised email.
 */
import { describe, expect, it } from "vitest";
import { breachesCheck } from "@/lib/checks/breaches";
import { emailSecurityCheck } from "@/lib/checks/email-security";
import { exposedServicesCheck } from "@/lib/checks/exposed-services";
import { ransomwareCheck } from "@/lib/checks/ransomware";
import type { CheckOutcome, CheckResult, FollowUp } from "@/lib/checks/types";
import { ctaHref, reportLink, socradarToolLinks, VENDOR_EMAIL_SOURCE } from "@/lib/config";
import { collectFollowUps, emailDraft } from "@/lib/questionnaire";

const outcome = (data: Record<string, unknown>): CheckOutcome => ({ status: "fail", score: 0, summary: "", findings: [], data });
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
const fu = (check: { followUps?: (o: CheckOutcome, d: string) => FollowUp[] }, data: Record<string, unknown>) =>
  check.followUps!(outcome(data), "acme.com");

describe("ransomware follow-ups", () => {
  const listing = (match: string, date: string | null) => ({ name: "Acme", group: "dragonforce", date, match, link: "https://www.ransomware.live/id/x" });

  it("recent confirmed listing -> 3 questions, 2 critical, naming the group and date", () => {
    const q = fu(ransomwareCheck, { listings: [listing("confirmed", daysAgo(30))] });
    expect(q.map((x) => x.priority)).toEqual(["critical", "critical", "high"]);
    expect(q[0].question).toContain("dragonforce");
    expect(q[0].question).toContain(daysAgo(30));
    expect(q[0].evidence).toBe("https://www.ransomware.live/id/x");
  });

  it("old confirmed listing -> one root-cause question", () => {
    const q = fu(ransomwareCheck, { listings: [listing("confirmed", "2022-03-01")] });
    expect(q).toHaveLength(1);
    expect(q[0]).toMatchObject({ priority: "high" });
    expect(q[0].question).toContain("in 2022");
  });

  it("possible match -> asks the vendor to confirm identity", () => {
    const q = fu(ransomwareCheck, { listings: [listing("possible", daysAgo(10))] });
    expect(q).toEqual([expect.objectContaining({ priority: "medium", question: expect.stringContaining("refer to your organisation") })]);
  });

  it("no listings -> no questions", () => {
    expect(fu(ransomwareCheck, { listings: [] })).toEqual([]);
    expect(fu(ransomwareCheck, {})).toEqual([]);
  });
});

describe("breach follow-ups", () => {
  const breach = (date: string, dataClasses: string[]) => ({ title: "Acme", date, accounts: 1234567, dataClasses, link: "https://haveibeenpwned.com/PwnedWebsites#Acme" });

  it("recent breach with passwords -> root cause + MFA questions, high priority", () => {
    const q = fu(breachesCheck, { breaches: [breach(daysAgo(100), ["Email addresses", "Passwords"])] });
    expect(q.map((x) => x.priority)).toEqual(["high", "high"]);
    expect(q[0].question).toContain("1,234,567 accounts");
    expect(q[1].question).toContain("multi-factor");
  });

  it("old breach without passwords -> one medium question", () => {
    const q = fu(breachesCheck, { breaches: [breach("2013-10-04", ["Email addresses"])] });
    expect(q).toEqual([expect.objectContaining({ priority: "medium" })]);
  });

  it("no breaches -> no questions", () => {
    expect(fu(breachesCheck, { breaches: [] })).toEqual([]);
  });
});

describe("email security follow-ups", () => {
  it.each([
    [40, 60, 0],  // strong: nothing to ask
    [30, 50, 0],  // quarantine + soft-fail: acceptable
    [40, 20, 2],  // p=none -> DMARC question + finance verification
    [40, 0, 2],   // no DMARC
    [40, 40, 2],  // partial pct
    [0, 60, 2],   // no SPF
    [0, 0, 3],    // nothing at all
  ])("spf=%i dmarc=%i -> %i questions", (spfPoints, dmarcPoints, n) => {
    expect(fu(emailSecurityCheck, { spfPoints, dmarcPoints })).toHaveLength(n);
  });

  it("describes the actual DMARC state", () => {
    expect(fu(emailSecurityCheck, { spfPoints: 40, dmarcPoints: 0 })[0].question).toMatch(/^Your domain has no DMARC record/);
    expect(fu(emailSecurityCheck, { spfPoints: 40, dmarcPoints: 20 })[0].question).toMatch(/monitor-only \(p=none\)/);
  });
});

describe("exposed services follow-ups", () => {
  it("KEV CVEs -> critical questions with NVD evidence; risky ports and EPSS -> high", () => {
    const q = fu(exposedServicesCheck, {
      ips: ["203.0.113.5"],
      kevDetails: [{ cve: "CVE-2024-38475", name: "Apache HTTP Server Improper Escaping", ransomware: true }],
      highEpss: ["CVE-2024-27316"],
      riskyPorts: [3389],
    });
    expect(q.map((x) => x.priority)).toEqual(["critical", "high", "high"]);
    expect(q[0].question).toContain("CVE-2024-38475");
    expect(q[0].question).toContain("used in ransomware campaigns");
    expect(q[0].question).toContain("203.0.113.5");
    expect(q[0].evidence).toBe("https://nvd.nist.gov/vuln/detail/CVE-2024-38475");
    expect(q[2].question).toContain("Remote Desktop (RDP) (port 3389)");
  });

  it("caps KEV questions at 5", () => {
    const kevDetails = Array.from({ length: 8 }, (_, i) => ({ cve: `CVE-2024-000${i}`, name: "x", ransomware: false }));
    expect(fu(exposedServicesCheck, { kevDetails })).toHaveLength(5);
  });

  it("clean servers -> no questions", () => {
    expect(fu(exposedServicesCheck, { ips: ["1.1.1.1"], kevDetails: [], highEpss: [], riskyPorts: [] })).toEqual([]);
  });
});

describe("questionnaire", () => {
  const result = (followUps: FollowUp[]): CheckResult =>
    ({ checkId: "x", domain: "acme.com", status: "fail", score: 0, summary: "", findings: [], followUps, durationMs: 0, checkedAt: "" });

  it("merges all checks, most urgent first, without duplicates", () => {
    const merged = collectFollowUps([
      result([{ priority: "medium", question: "M" }, { priority: "low", question: "L" }]),
      result([{ priority: "critical", question: "C" }, { priority: "medium", question: "M" }]),
      result([{ priority: "high", question: "H" }]),
    ]);
    expect(merged.map((f) => f.question)).toEqual(["C", "H", "M", "L"]);
  });

  it("tolerates results without follow-ups (e.g. cached older responses)", () => {
    const old = { ...result([]), followUps: undefined } as unknown as CheckResult;
    expect(collectFollowUps([old])).toEqual([]);
  });

  it("builds a ready-to-send email with numbered questions, evidence and a deadline", () => {
    const text = emailDraft(
      "acme.com",
      [
        { priority: "critical", question: "Q1?", evidence: "https://example.org/e1" },
        { priority: "high", question: "Q2?" },
      ],
      { now: new Date("2026-11-01T12:00:00Z") },
    );
    expect(text.split("\n")[0]).toBe("Subject: Security follow-up for acme.com");
    expect(text).toContain("on 1 November 2026");
    expect(text).toContain("1. Q1?\n   Evidence: https://example.org/e1");
    expect(text).toContain("2. Q2?");
    expect(text).toContain("by 11 November 2026");
    expect(text).not.toContain("full report");
  });

  it("adds the vendor's report link when given, before the deadline line", () => {
    const url = reportLink("https://vendor-risk-snapshot.vercel.app", "acme.com");
    const text = emailDraft("acme.com", [{ priority: "high", question: "Q?" }], { now: new Date("2026-11-01T12:00:00Z"), reportUrl: url });
    expect(text).toContain(`The full report, with the public evidence behind each item, is here:\n${url}\n\nWe would appreciate`);
  });
});

describe("links", () => {
  it("report link opens the vendor's own report and tags the referral loop", () => {
    const u = new URL(reportLink("https://vendor-risk-snapshot.vercel.app", "acme.com"));
    expect(u.origin + u.pathname).toBe("https://vendor-risk-snapshot.vercel.app/");
    expect(Object.fromEntries(u.searchParams)).toEqual({
      d: "acme.com",
      utm_source: VENDOR_EMAIL_SOURCE,
      utm_medium: "email",
      utm_campaign: "vendor-questionnaire",
    });
  });

  it("CTA links carry UTM tags per campaign", () => {
    for (const campaign of ["homepage", "vendor-loop"] as const) {
      const u = new URL(ctaHref(campaign));
      expect(u.searchParams.get("utm_source")).toBe("vendor-risk-snapshot");
      expect(u.searchParams.get("utm_medium")).toBe("referral");
      expect(u.searchParams.get("utm_campaign")).toBe(campaign);
    }
  });
});

describe("socradarToolLinks", () => {
  it("hands the vendor domain to SOCRadar's own tools, tagged for attribution", () => {
    const links = socradarToolLinks("acme.com");
    expect(links.map((l) => l.id)).toEqual(["dark-web-report", "external-attack-surface"]);
    for (const l of links) {
      const u = new URL(l.url);
      expect(u.origin).toBe("https://socradar.io");
      expect(u.pathname).toBe(`/free-tools/${l.id}`);
      expect(u.searchParams.get("domain")).toBe("acme.com");
      expect(u.searchParams.get("utm_source")).toBe("vendor-risk-snapshot");
      expect(u.searchParams.get("utm_campaign")).toMatch(/^deep-link-/);
    }
  });
});
