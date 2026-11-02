/**
 * CISA Known Exploited Vulnerabilities (KEV) catalog: the US government's
 * list of CVEs that are confirmed to be exploited in the wild.
 * The full catalog (~1.5 MB) is downloaded once and kept in memory for 6 hours.
 */
import { fetchJson } from "../http";

export const KEV_URL =
  "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json";

export interface KevEntry {
  cveID: string;
  vendorProject: string;
  product: string;
  vulnerabilityName: string;
  dateAdded: string;
  knownRansomwareCampaignUse: string; // "Known" | "Unknown"
}

const TTL_MS = 6 * 60 * 60 * 1000;
let cache: { at: number; map: Map<string, KevEntry> } | null = null;
let inflight: Promise<Map<string, KevEntry>> | null = null;

export async function getKev(): Promise<Map<string, KevEntry>> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.map;
  inflight ??= fetchJson<{ vulnerabilities: KevEntry[] }>(KEV_URL, { timeoutMs: 15_000 })
    .then((json) => {
      const map = new Map(json.vulnerabilities.map((v) => [v.cveID.toUpperCase(), v]));
      cache = { at: Date.now(), map };
      return map;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}
