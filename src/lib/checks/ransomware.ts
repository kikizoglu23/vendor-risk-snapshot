/**
 * CHECK 1 — Ransomware leak-site listings
 *
 * Ransomware gangs publish the names of victims who refuse to pay on their
 * "leak sites". Two independent trackers are queried in parallel:
 *  - ransomware.live (free public API), and
 *  - SOCRadar Ransomware Intelligence (the endpoint behind its free tool).
 * The same matching rules apply to both. A listing found in both is merged
 * and marked as seen by two sources; if one source is down, the other is used.
 *
 * Matching logic (to avoid false positives):
 *  - CONFIRMED: the listing's website/domain field contains the vendor's domain.
 *  - POSSIBLE:  the victim name equals the vendor's brand name (e.g. "acme"),
 *               but no domain is recorded → needs a human to verify.
 *  Anything else that merely contains the keyword is ignored.
 */
import { cached } from "../cache";
import { brandLabel } from "../domain";
import { fetchJson, HttpError } from "../http";
import { SOCRADAR_RANSOMWARE_PAGE, searchVictims, type SocradarVictim, victimPageUrl } from "../sources/socradar";
import type { CheckDefinition, Finding, FollowUp } from "./types";

const API = "https://api.ransomware.live/v2/searchvictims";

/** ransomware.live has used slightly different field names over time. */
export interface RawVictim {
  victim?: string;
  post_title?: string;
  group?: string;
  group_name?: string;
  domain?: string;
  website?: string;
  attackdate?: string;
  discovered?: string;
  published?: string;
  country?: string;
  activity?: string;
  url?: string;
  post_url?: string;
}

export type SourceName = "ransomware.live" | "SOCRadar";

export interface Listing {
  name: string;
  /** Primary evidence link (first source that reported it). */
  link: string;
  /** Every source that reported this incident, with its own evidence link. */
  sources: { source: SourceName; url: string }[];
  group: string;
  date: string | null;
  country?: string;
  sector?: string;
  match: "confirmed" | "possible";
  /** Other organisations named in the same listing (e.g. a supplier or partner). */
  alsoNamed?: string[];
}

const MONTH = 30 * 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

function clean(s: string | undefined): string {
  return (s ?? "").toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").trim();
}

/** Legal-form suffixes ignored when comparing company names. */
const LEGAL_SUFFIXES = new Set([
  "inc", "incorporated", "llc", "ltd", "limited", "corp", "corporation", "co", "company",
  "gmbh", "ag", "sa", "sas", "srl", "spa", "bv", "nv", "plc", "pty", "as", "aş", "oy", "ab",
]);

/** "ACME Inc." → "acme", "AT&T" → "att", "Acme Holding GmbH" → "acmeholding". */
export function companyKey(name: string): string {
  const words = name.toLowerCase().replace(/\./g, "").replace(/[^a-z0-9ş\s]/g, " ").split(/\s+/).filter(Boolean);
  while (words.length > 1 && LEGAL_SUFFIXES.has(words.at(-1)!)) words.pop();
  return words.join("").replace(/ş/g, "s");
}

export function toListing(v: RawVictim, domain: string, brand: string, source: SourceName = "ransomware.live"): Listing | null {
  const name = (v.victim ?? v.post_title ?? "").trim();
  // The "domain" field sometimes holds a company name instead of a domain.
  const looksLikeDomain = (s: string) => /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/.*)?$/.test(s);
  const site = [clean(v.domain), clean(v.website)].find(looksLikeDomain) ?? "";
  const lowerName = clean(name);
  const normName = companyKey(lowerName);
  // A listing can name several organisations: "verveba.com \ www.att.com", "a.com, b.com".
  // "/" is deliberately NOT a separator: "linkedin.com/company/x" is a profile page, not LinkedIn.
  const tokens = lowerName.split(/\s*(?:\\|,|;|\||&|\s)\s*/).map(clean).filter(Boolean);
  // "acme.com" or "acme.com (Acme Corp)" — but not "acme.com.tr" or "acme.com/company/x"
  const isVendor = new RegExp(`^(?:[a-z0-9-]+\\.)*${domain.replace(/[.]/g, "\\.")}(?![a-z0-9.\\-/])`);
  const nameIsDomain = tokens.some((t) => isVendor.test(t));
  let match: Listing["match"] | null = null;
  // Compare the host only, and only when there is no path: "linkedin.com/company/x"
  // is a profile page hosted on LinkedIn, not LinkedIn itself being the victim.
  const [siteHost, ...sitePath] = site.split("/");
  const isRootSite = sitePath.join("").length === 0;
  if (site && isRootSite && (siteHost === domain || siteHost.endsWith(`.${domain}`))) {
    match = "confirmed";
  } else if (nameIsDomain) {
    match = "confirmed"; // gangs often use the domain itself as the victim name
  } else if (!site && normName === brand) {
    match = "possible";
  }
  if (!match) return null;
  const alsoNamed = [...new Set(tokens.filter((t) => /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(t) && !isVendor.test(t)))];
  const rawDate = v.attackdate || v.discovered || v.published || null;
  const trusted = v.url?.startsWith("https://www.ransomware.live/") || v.url?.startsWith(`${SOCRADAR_RANSOMWARE_PAGE}/`);
  const link = trusted
    ? v.url!
    : source === "SOCRadar"
      ? SOCRADAR_RANSOMWARE_PAGE
      : `https://www.ransomware.live/search?q=${encodeURIComponent(name)}`;
  return {
    name,
    link,
    sources: [{ source, url: link }],
    group: v.group ?? v.group_name ?? "unknown",
    date: rawDate ? rawDate.slice(0, 10) : null,
    country: v.country || undefined,
    sector: v.activity || undefined,
    match,
    ...(alsoNamed.length ? { alsoNamed } : {}),
  };
}

/** Maps a SOCRadar victim record onto the shape the matching rules expect. */
export function fromSocradar(v: SocradarVictim): RawVictim {
  return {
    victim: v.company ?? "",
    group: v.threat_actor ?? undefined,
    domain: v.domain ?? "",
    attackdate: v.attack_at || v.discovered_at || undefined,
    country: v.country ?? undefined,
    activity: v.industry ?? undefined,
    url: v.slug ? victimPageUrl(v.slug) : undefined,
  };
}

/** "The Gentlemen" → "thegentlemen", "LockBit 3.0" → "lockbit30". */
export function groupKey(group: string): string {
  return group.toLowerCase().replace(/[^a-z0-9]/g, "");
}

const DAY = 24 * 60 * 60 * 1000;

/** Same incident = same group (names normalised) and dates within 3 days (or a date missing). */
function sameIncident(a: Listing, b: Listing): boolean {
  const ga = groupKey(a.group);
  const gb = groupKey(b.group);
  const sameGroup = ga === gb || (Math.min(ga.length, gb.length) >= 4 && (ga.startsWith(gb) || gb.startsWith(ga)));
  if (!sameGroup) return false;
  if (!a.date || !b.date) return true;
  return Math.abs(Date.parse(a.date) - Date.parse(b.date)) <= 3 * DAY;
}

/** Merges listings reported by several sources into one entry per incident. */
export function mergeListings(listings: Listing[]): Listing[] {
  const merged: Listing[] = [];
  for (const l of listings) {
    const twin = merged.find((m) => sameIncident(m, l));
    if (!twin) {
      merged.push({ ...l, sources: [...l.sources] });
      continue;
    }
    for (const s of l.sources) if (!twin.sources.some((t) => t.source === s.source)) twin.sources.push(s);
    if (l.match === "confirmed") twin.match = "confirmed";
    if (!twin.date || (l.date && l.date < twin.date)) twin.date = l.date;
    twin.country ??= l.country;
    twin.sector ??= l.sector;
    if (l.alsoNamed) twin.alsoNamed = [...new Set([...(twin.alsoNamed ?? []), ...l.alsoNamed])];
  }
  return merged.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
}

async function fetchRansomwareLive(brand: string): Promise<RawVictim[]> {
  const raw = await cached(`ransomware:${brand}`, HOUR, async () => {
    try {
      return await fetchJson<RawVictim[]>(`${API}/${encodeURIComponent(brand)}`, { timeoutMs: 8_000 });
    } catch (err) {
      if (err instanceof HttpError && err.status === 404) return []; // 404 = no results
      throw err;
    }
  });
  return Array.isArray(raw) ? raw : [];
}

export const ransomwareCheck: CheckDefinition = {
  id: "ransomware",
  name: "Ransomware leak sites",
  shortName: "Ransomware",
  question: "Has this vendor been listed as a victim on a ransomware leak site?",
  whyItMatters:
    "A listing means attackers claim they stole the vendor's data. If you share data with this vendor, your data may be in that leak — and the vendor may still be recovering.",
  weight: 35,
  sources: [
    { name: "ransomware.live", url: "https://www.ransomware.live" },
    { name: "SOCRadar Ransomware Intelligence", url: SOCRADAR_RANSOMWARE_PAGE },
  ],
  limitations:
    "A listing is the attacker's claim, not a confirmed breach — some groups post exaggerated or recycled data, especially about large brands, so ask the vendor before concluding. Covers only victims that gangs publicly name (paid-ransom cases are never listed). Name-only matches are flagged as 'possible' and need manual verification. SOCRadar data comes from the endpoint behind its free Ransomware Intelligence tool (not a documented public API) and is subject to its daily free limit; when it is unavailable the check uses ransomware.live alone.",

  async run(domain) {
    const brand = brandLabel(domain);
    const [rl, sr] = await Promise.allSettled([fetchRansomwareLive(brand), searchVictims(domain)]);
    if (rl.status === "rejected" && sr.status === "rejected") throw rl.reason;

    const fromRl = rl.status === "fulfilled" ? rl.value.map((v) => toListing(v, domain, brand, "ransomware.live")) : [];
    const fromSr = sr.status === "fulfilled" ? sr.value.map((v) => toListing(fromSocradar(v), domain, brand, "SOCRadar")) : [];
    const listings = mergeListings([...fromRl, ...fromSr].filter((l): l is Listing => l !== null));
    const sourceStatus = {
      "ransomware.live": rl.status === "fulfilled" ? "ok" : `unavailable (${(rl.reason as Error).message})`,
      SOCRadar: sr.status === "fulfilled" ? "ok" : `unavailable (${(sr.reason as Error).message})`,
    };

    const confirmed = listings.filter((l) => l.match === "confirmed");
    const possible = listings.filter((l) => l.match === "possible");
    const recent = confirmed.filter((l) => l.date && Date.now() - Date.parse(l.date) < 12 * MONTH);

    const findings: Finding[] = listings.map((l) => {
      const socradar = l.sources.find((s) => s.source === "SOCRadar");
      return {
      severity:
        l.match === "possible"
          ? "medium"
          : recent.includes(l)
            ? "critical"
            : "high",
      title: `${l.match === "confirmed" ? "Listed" : "Possible listing"} by ${l.group}${l.date ? ` on ${l.date}` : ""}`,
      detail: [
        `Victim name: "${l.name}"`,
        l.sector && `Sector: ${l.sector}`,
        l.country && `Country: ${l.country}`,
        l.sources.length > 1
          ? `Seen by ${l.sources.length} independent sources (${l.sources.map((s) => s.source).join(", ")})`
          : `Source: ${l.sources[0].source}`,
        l.match === "possible" && "Matched on company name only — verify it is the same organisation.",
        l.alsoNamed?.length &&
          `Also named in this listing: ${l.alsoNamed.join(", ")} — possibly an incident at a supplier or partner involving this vendor's data`,
      ]
        .filter(Boolean)
        .join(" · "),
      link: l.link,
      related: socradar && socradar.url !== l.link ? { label: "SOCRadar Ransomware Intelligence", url: socradar.url } : undefined,
      } satisfies Finding;
    });
    const down = Object.entries(sourceStatus).filter(([, v]) => v !== "ok").map(([k]) => k);
    if (down.length === 1) {
      findings.push({
        severity: "info",
        title: `${down[0]} was unavailable for this check`,
        detail: `Results are based on ${down[0] === "SOCRadar" ? "ransomware.live" : "SOCRadar"} only. Try again later for full coverage.`,
      });
    }

    const data = { searchedFor: brand, confirmed: confirmed.length, possible: possible.length, listings, sourceStatus };
    const corroborated = (l: Listing) => (l.sources.length > 1 ? `; seen by ${l.sources.length} sources` : "");

    if (recent.length > 0) {
      return {
        status: "fail",
        score: 0,
        summary: `Listed on a ransomware leak site in the last 12 months (${recent[0].group}, ${recent[0].date}${corroborated(recent[0])}).`,
        findings,
        data,
      };
    }
    if (confirmed.length > 0) {
      return {
        status: "fail",
        score: 40,
        summary: `Listed on a ransomware leak site more than 12 months ago (${confirmed[0].group}, ${confirmed[0].date ?? "date unknown"}${corroborated(confirmed[0])}).`,
        findings,
        data,
      };
    }
    if (possible.length > 0) {
      return {
        status: "warn",
        score: 70,
        summary: `${possible.length} possible listing(s) matched on company name only — needs manual verification.`,
        findings,
        data,
      };
    }
    return {
      status: "pass",
      score: 100,
      summary: down.length
        ? `No ransomware leak-site listings found (only ${down[0] === "SOCRadar" ? "ransomware.live" : "SOCRadar"} could be checked).`
        : "No ransomware leak-site listings found in either source.",
      findings,
      data,
    };
  },


  followUps(outcome) {
    const listings = (outcome.data?.listings ?? []) as Listing[];
    const confirmed = listings.filter((l) => l.match === "confirmed");
    const recent = confirmed.filter((l) => l.date && Date.now() - Date.parse(l.date) < 12 * MONTH);
    const out: FollowUp[] = [];
    if (recent.length > 0) {
      const l = recent[0];
      out.push(
        {
          priority: "critical",
          question: `The ransomware group "${l.group}" listed your organisation on its leak site on ${l.date}. Were any systems or data related to our engagement affected, including data we have shared with you?`,
          evidence: l.link,
        },
        {
          priority: "critical",
          question:
            "What containment and remediation steps have been completed, and has an independent forensic investigation confirmed the attackers no longer have access? Please share a summary or an attestation letter.",
        },
        { priority: "high", question: "Have affected customers and the relevant regulators been notified, and when?" },
      );
    } else if (confirmed.length > 0) {
      const l = confirmed[0];
      out.push({
        priority: "high",
        question: `The ransomware group "${l.group}" claimed an attack on your organisation${l.date ? ` in ${l.date.slice(0, 4)}` : ""}. What root cause was identified, and which security controls were added afterwards?`,
        evidence: l.link,
      });
    }
    for (const l of confirmed.filter((x) => x.alsoNamed?.length).slice(0, 2)) {
      out.push({
        priority: "high",
        question: `The "${l.group}" listing${l.date ? ` of ${l.date}` : ""} also names ${l.alsoNamed!.join(", ")}. Is this one of your suppliers or partners, and did it hold data related to our engagement?`,
        evidence: l.link,
      });
    }
    for (const l of listings.filter((x) => x.match === "possible").slice(0, 3)) {
      out.push({
        priority: "medium",
        question: `A ransomware leak site lists a victim named "${l.name}" (${l.group}${l.date ? `, ${l.date}` : ""}). Does this listing refer to your organisation?`,
        evidence: l.link,
      });
    }
    return out;
  },
};
