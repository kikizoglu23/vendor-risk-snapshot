/**
 * CHECK 2, Publicly disclosed data breaches
 *
 * Have I Been Pwned (HIBP) keeps a verified catalogue of data breaches.
 * The /breaches?domain= endpoint is free, needs no API key, and returns
 * breaches OF the given website (e.g. adobe.com -> the 2013 Adobe breach).
 * It does not expose any individual's email or password.
 */
import { fetchJson } from "../http";
import type { CheckDefinition, Finding, FollowUp } from "./types";

const API = "https://haveibeenpwned.com/api/v3/breaches";

interface HibpBreach {
  Name: string;
  Title: string;
  Domain: string;
  BreachDate: string;
  PwnCount: number;
  DataClasses: string[];
  IsVerified: boolean;
}

const YEAR = 365 * 24 * 60 * 60 * 1000;
const SENSITIVE = ["Passwords", "Credit cards", "Bank account numbers", "Social security numbers", "Passport numbers"];

export const breachesCheck: CheckDefinition = {
  id: "breaches",
  name: "Data breach history",
  shortName: "Breaches",
  question: "Has this vendor suffered a publicly disclosed data breach?",
  whyItMatters:
    "Past breaches show how the vendor has handled security before, and which kinds of data (passwords, payment data) were exposed. A recent breach is a strong signal to ask the vendor what has changed since.",
  weight: 20,
  sources: [{ name: "Have I Been Pwned", url: "https://haveibeenpwned.com/PwnedWebsites" }],
  limitations:
    "Only breaches whose data was leaked and verified by HIBP are listed.",

  async run(domain) {
    const breaches = await fetchJson<HibpBreach[]>(`${API}?domain=${encodeURIComponent(domain)}`);
    breaches.sort((a, b) => b.BreachDate.localeCompare(a.BreachDate));

    const findings: Finding[] = breaches.map((b) => {
      const sensitive = b.DataClasses.filter((c) => SENSITIVE.includes(c));
      const recent = Date.now() - Date.parse(b.BreachDate) < 2 * YEAR;
      return {
        severity: recent ? "high" : sensitive.length ? "medium" : "low",
        title: `${b.Title} breach on ${b.BreachDate} (${b.PwnCount.toLocaleString("en-US")} accounts)`,
        detail: `Exposed: ${b.DataClasses.join(", ")}.${b.IsVerified ? "" : " Unverified breach."}`,
        link: `https://haveibeenpwned.com/PwnedWebsites#${b.Name}`,
      };
    });

    const data = {
      count: breaches.length,
      breaches: breaches.map((b) => ({
        title: b.Title,
        date: b.BreachDate,
        accounts: b.PwnCount,
        dataClasses: b.DataClasses,
        link: `https://haveibeenpwned.com/PwnedWebsites#${b.Name}`,
      })),
    };

    if (breaches.length === 0) {
      return { status: "pass", score: 100, summary: "No publicly disclosed breaches found.", findings, data };
    }

    const latest = breaches[0];
    const recent = Date.now() - Date.parse(latest.BreachDate) < 2 * YEAR;
    // Start at 40 (recent) or 70 (older), minus 10 for each additional breach.
    const score = Math.max(20, (recent ? 40 : 70) - 10 * (breaches.length - 1));
    return {
      status: recent ? "fail" : "warn",
      score,
      summary: `${breaches.length} disclosed breach(es); most recent ${latest.BreachDate} (${latest.PwnCount.toLocaleString("en-US")} accounts).`,
      findings,
      data,
    };
  },


  followUps(outcome) {
    const breaches = (outcome.data?.breaches ?? []) as { title: string; date: string; accounts: number; dataClasses: string[]; link: string }[];
    if (breaches.length === 0) return [];
    const latest = breaches[0];
    const recent = Date.now() - Date.parse(latest.date) < 2 * YEAR;
    const out: FollowUp[] = [
      {
        priority: recent ? "high" : "medium",
        question: `Your ${latest.date} breach exposed ${latest.accounts.toLocaleString("en-US")} accounts (${latest.dataClasses.slice(0, 4).join(", ")}). What was the root cause, and what has changed since?`,
        evidence: latest.link,
      },
    ];
    if (breaches.some((b) => b.dataClasses.includes("Passwords"))) {
      out.push({
        priority: recent ? "high" : "medium",
        question:
          "Passwords were exposed in a past breach. Is multi-factor authentication now enforced for all customer and administrator accounts, and how are passwords stored today?",
      });
    }
    return out;
  },
};
