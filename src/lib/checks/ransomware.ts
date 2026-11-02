/**
 * CHECK 1 — Ransomware leak-site listings
 *
 * Ransomware gangs publish the names of victims who refuse to pay on their
 * "leak sites". ransomware.live scrapes those sites and offers a free API.
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

interface Listing {
  name: string;
  link: string;
  group: string;
  date: string | null;
  country?: string;
  sector?: string;
  match: "confirmed" | "possible";
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

export function toListing(v: RawVictim, domain: string, brand: string): Listing | null {
  const name = (v.victim ?? v.post_title ?? "").trim();
  // The "domain" field sometimes holds a company name instead of a domain.
  const looksLikeDomain = (s: string) => /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/.*)?$/.test(s);
  const site = [clean(v.domain), clean(v.website)].find(looksLikeDomain) ?? "";
  const lowerName = clean(name);
  const normName = companyKey(lowerName);
  // "acme.com" or "acme.com (Acme Corp)" — but not "acme.com.tr" or "acme.com/company/x"
  const nameIsDomain = new RegExp(`^${domain.replace(/[.]/g, "\\.")}(?![a-z0-9.\\-/])`).test(lowerName);
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
  const rawDate = v.attackdate || v.discovered || v.published || null;
  const link = v.url?.startsWith("https://www.ransomware.live/")
    ? v.url
    : `https://www.ransomware.live/search?q=${encodeURIComponent(name)}`;
  return {
    name,
    link,
    group: v.group ?? v.group_name ?? "unknown",
    date: rawDate ? rawDate.slice(0, 10) : null,
    country: v.country || undefined,
    sector: v.activity || undefined,
    match,
  };
}

export const ransomwareCheck: CheckDefinition = {
  id: "ransomware",
  name: "Ransomware leak sites",
  shortName: "Ransomware",
  question: "Has this vendor been listed as a victim on a ransomware leak site?",
  whyItMatters:
    "A listing means attackers claim they stole the vendor's data. If you share data with this vendor, your data may be in that leak — and the vendor may still be recovering.",
  weight: 35,
  sources: [{ name: "ransomware.live", url: "https://www.ransomware.live" }],
  limitations:
    "A listing is the attacker's claim, not a confirmed breach — some groups post exaggerated or recycled data, especially about large brands, so ask the vendor before concluding. Covers only victims that gangs publicly name (paid-ransom cases are never listed). Name-only matches are flagged as 'possible' and need manual verification.",

  async run(domain) {
    const brand = brandLabel(domain);
    let raw = await cached(`ransomware:${brand}`, HOUR, async () => {
      try {
        return await fetchJson<RawVictim[]>(`${API}/${encodeURIComponent(brand)}`, { timeoutMs: 8_000 });
      } catch (err) {
        if (err instanceof HttpError && err.status === 404) return []; // 404 = no results
        throw err;
      }
    });
    if (!Array.isArray(raw)) raw = [];

    const listings = raw
      .map((v) => toListing(v, domain, brand))
      .filter((l): l is Listing => l !== null)
      .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));

    const confirmed = listings.filter((l) => l.match === "confirmed");
    const possible = listings.filter((l) => l.match === "possible");
    const recent = confirmed.filter((l) => l.date && Date.now() - Date.parse(l.date) < 12 * MONTH);

    const findings: Finding[] = listings.map((l) => ({
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
        l.match === "possible" && "Matched on company name only — verify it is the same organisation.",
      ]
        .filter(Boolean)
        .join(" · "),
      link: l.link,
    }));

    const data = { searchedFor: brand, confirmed: confirmed.length, possible: possible.length, listings };

    if (recent.length > 0) {
      return {
        status: "fail",
        score: 0,
        summary: `Listed on a ransomware leak site in the last 12 months (${recent[0].group}, ${recent[0].date}).`,
        findings,
        data,
      };
    }
    if (confirmed.length > 0) {
      return {
        status: "fail",
        score: 40,
        summary: `Listed on a ransomware leak site more than 12 months ago (${confirmed[0].group}, ${confirmed[0].date ?? "date unknown"}).`,
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
      summary: "No ransomware leak-site listings found.",
      findings: [],
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
