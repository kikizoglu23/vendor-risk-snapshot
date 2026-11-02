/**
 * FIRST EPSS (Exploit Prediction Scoring System): the probability (0–1)
 * that a CVE will be exploited in the next 30 days.
 */
import { fetchJson } from "../http";

export const EPSS_URL = "https://api.first.org/data/v1/epss";

export async function getEpss(cves: string[]): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  // The API accepts comma-separated lists; batch to keep URLs short.
  for (let i = 0; i < cves.length; i += 50) {
    const batch = cves.slice(i, i + 50);
    const json = await fetchJson<{ data: { cve: string; epss: string }[] }>(
      `${EPSS_URL}?cve=${batch.join(",")}`,
    );
    for (const row of json.data) result.set(row.cve.toUpperCase(), Number(row.epss));
  }
  return result;
}
