/**
 * SOCRadar as a second ransomware source, using record shapes copied from
 * real SOCRadar responses (including its fuzzy search results).
 */
import { describe, expect, it } from "vitest";
import { fromSocradar, groupKey, type Listing, mergeListings, toListing } from "@/lib/checks/ransomware";
import { socradarToolLinks } from "@/lib/config";
import { parseSearch, SocradarUnavailable, victimPageUrl } from "@/lib/sources/socradar";

const skyplan = {
  company: "Skyplan Services Limited",
  domain: "skyplan.com",
  country: "Canada",
  industry: "Transportation",
  threat_actor: "thegentlemen",
  attack_at: "2026-10-06T19:26:11",
  discovered_at: "2026-10-06T21:37:04.375625",
  slug: "skyplan-services-limited-thegentlemen-17bd1e67",
  status: "claimed",
  confidence_score: 0.7,
};

describe("parseSearch", () => {
  it("returns the victim items of a normal response", () => {
    expect(parseSearch({ victims: { total: 1, items: [skyplan] }, groups: [] })).toEqual([skyplan]);
  });

  it("treats a free-limit or verification answer as unavailable (never as 'no results')", () => {
    expect(() => parseSearch({ is_success: false, error: { code: "captcha_quota_required" } })).toThrow(SocradarUnavailable);
    expect(() => parseSearch({ error: { code: "captcha_required" } })).toThrow(/captcha_required/);
    expect(() => parseSearch({ detail: "something else" })).toThrow(SocradarUnavailable);
    expect(() => parseSearch(null)).toThrow(SocradarUnavailable);
  });

  it("builds the public victim page link", () => {
    expect(victimPageUrl(skyplan.slug)).toBe(
      "https://socradar.io/free-tools/ransomware-intelligence/victims/skyplan-services-limited-thegentlemen-17bd1e67",
    );
  });
});

describe("SOCRadar records through the same strict matching rules", () => {
  it("confirms an exact domain match and links to SOCRadar's victim page", () => {
    const l = toListing(fromSocradar(skyplan), "skyplan.com", "skyplan", "SOCRadar");
    expect(l).toMatchObject({ match: "confirmed", group: "thegentlemen", date: "2026-10-06", country: "Canada", sector: "Transportation" });
    expect(l?.link).toBe(victimPageUrl(skyplan.slug));
    expect(l?.sources).toEqual([{ source: "SOCRadar", url: victimPageUrl(skyplan.slug) }]);
  });

  it("accepts a subdomain of the vendor (adsense.google.com for google.com)", () => {
    const v = { ...skyplan, company: "Google", domain: "adsense.google.com", threat_actor: "shinyhunters", slug: "google-x" };
    expect(toListing(fromSocradar(v), "google.com", "google", "SOCRadar")?.match).toBe("confirmed");
  });

  it("drops SOCRadar's fuzzy hits that belong to other companies", () => {
    const fuzzy = [
      ["google.com", "google", { company: "tdotnet", domain: "dotinternetbd.com" }],
      ["att.com", "att", { company: "Hyatt", domain: "hyatt.com" }],
      ["linkedin.com", "linkedin", { company: "Some Company", domain: null }],
    ] as const;
    for (const [domain, brand, v] of fuzzy) {
      expect(toListing(fromSocradar({ ...skyplan, ...v }), domain, brand, "SOCRadar"), domain).toBeNull();
    }
  });

  it("handles missing fields (unnamed victims, no slug, no dates)", () => {
    const v = { company: null, domain: "acme.com", threat_actor: null, attack_at: null, discovered_at: null, slug: null };
    const l = toListing(fromSocradar(v), "acme.com", "acme", "SOCRadar");
    expect(l).toMatchObject({ match: "confirmed", group: "unknown", date: null, link: "https://socradar.io/free-tools/ransomware-intelligence" });
  });
});

describe("groupKey", () => {
  it.each([
    ["The Gentlemen", "thegentlemen"],
    ["thegentlemen", "thegentlemen"],
    ["INC Ransom", "incransom"],
    ["LockBit 3.0", "lockbit30"],
  ])("%s → %s", (input, expected) => {
    expect(groupKey(input)).toBe(expected);
  });
});

describe("mergeListings", () => {
  const listing = (group: string, date: string | null, source: Listing["sources"][0]["source"], match: Listing["match"] = "confirmed"): Listing => ({
    name: "Acme",
    link: `https://example.org/${source}`,
    sources: [{ source, url: `https://example.org/${source}` }],
    group,
    date,
    match,
  });

  it("merges the same incident reported by both sources, keeping both evidence links", () => {
    const merged = mergeListings([listing("thegentlemen", "2026-10-06", "ransomware.live"), listing("The Gentlemen", "2026-10-07", "SOCRadar")]);
    expect(merged).toHaveLength(1);
    expect(merged[0].sources.map((s) => s.source)).toEqual(["ransomware.live", "SOCRadar"]);
    expect(merged[0].link).toBe("https://example.org/ransomware.live");
    expect(merged[0].date).toBe("2026-10-06");
  });

  it("keeps different groups and distant dates apart", () => {
    expect(mergeListings([listing("EndZone", "2026-09-18", "ransomware.live"), listing("INC Ransom", "2026-10-15", "SOCRadar")])).toHaveLength(2);
    expect(mergeListings([listing("everest", "2025-10-21", "ransomware.live"), listing("everest", "2026-03-01", "SOCRadar")])).toHaveLength(2);
  });

  it("matches renamed variants of a group (lockbit3 / LockBit 3.0)", () => {
    expect(mergeListings([listing("lockbit3", "2024-01-01", "ransomware.live"), listing("LockBit 3.0", "2024-01-02", "SOCRadar")])).toHaveLength(1);
  });

  it("upgrades a possible match when the other source confirms it, and sorts newest first", () => {
    const merged = mergeListings([
      listing("akira", "2025-01-01", "ransomware.live", "possible"),
      listing("Akira", "2025-01-02", "SOCRadar", "confirmed"),
      listing("qilin", "2026-05-01", "SOCRadar"),
    ]);
    expect(merged.map((m) => [m.group, m.match])).toEqual([
      ["qilin", "confirmed"],
      ["akira", "confirmed"],
    ]);
  });
});

describe("socradarToolLinks", () => {
  it("hands the vendor domain to SOCRadar's protected tools, tagged for attribution", () => {
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
