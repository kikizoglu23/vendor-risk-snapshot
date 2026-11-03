/**
 * SOCRadar Ransomware Intelligence — victim search.
 *
 * This is the JSON endpoint behind SOCRadar's free Ransomware Intelligence
 * tool (https://socradar.io/free-tools/ransomware-intelligence). It is not a
 * documented public API, and SOCRadar's free tools share a daily free limit
 * protected by a human check. We therefore:
 *  - send plain, low-volume requests only (no tokens, no imitation headers),
 *  - never retry on a limit or verification response,
 *  - pause calls for 15 minutes after one, and
 *  - cache results for an hour.
 * When SOCRadar is unavailable the ransomware check carries on with
 * ransomware.live alone. A production version should use an official API.
 */
import { cached } from "../cache";
import { fetchJson, HttpError } from "../http";

export const SOCRADAR_RANSOMWARE_API = "https://socradar.io/free-tools/api/ransomware-intelligence";
export const SOCRADAR_RANSOMWARE_PAGE = "https://socradar.io/free-tools/ransomware-intelligence";

export interface SocradarVictim {
  company?: string | null;
  domain?: string | null;
  country?: string | null;
  industry?: string | null;
  threat_actor?: string | null;
  attack_at?: string | null;
  discovered_at?: string | null;
  slug?: string | null;
  status?: string | null;
  confidence_score?: number | null;
}

interface SearchResponse {
  victims?: { items?: SocradarVictim[] };
  error?: { code?: string } | null;
  is_success?: boolean;
}

/** Thrown when SOCRadar asks for a human check or reports its free limit. */
export class SocradarUnavailable extends Error {}

const PAUSE_MS = 15 * 60 * 1000;
let pausedUntil = 0;

/** Exposed for tests. */
export function resetSocradarPause() {
  pausedUntil = 0;
}

export function victimPageUrl(slug: string): string {
  return `${SOCRADAR_RANSOMWARE_PAGE}/victims/${encodeURIComponent(slug)}`;
}

/** Turns a raw response into victims, or throws if it is a limit / verification answer. */
export function parseSearch(json: unknown): SocradarVictim[] {
  const body = (json ?? {}) as SearchResponse;
  const code = body.error?.code ?? "";
  if (code || body.is_success === false) {
    throw new SocradarUnavailable(code ? `SOCRadar: ${code}` : "SOCRadar: request not accepted");
  }
  const items = body.victims?.items;
  if (!Array.isArray(items)) throw new SocradarUnavailable("SOCRadar: unexpected response");
  return items;
}

/** Victims whose record may relate to `domain` (SOCRadar's search is fuzzy; callers must filter strictly). */
export async function searchVictims(domain: string): Promise<SocradarVictim[]> {
  if (Date.now() < pausedUntil) throw new SocradarUnavailable("SOCRadar: paused after its free limit was reached");
  return cached(`socradar-ransomware:${domain}`, 60 * 60 * 1000, async () => {
    try {
      const json = await fetchJson<unknown>(`${SOCRADAR_RANSOMWARE_API}/search?q=${encodeURIComponent(domain)}&days=1825`, {
        timeoutMs: 8_000,
        retries: 0, // never retry against a free limit
      });
      return parseSearch(json);
    } catch (err) {
      const limited =
        err instanceof SocradarUnavailable ||
        (err instanceof HttpError && [401, 403, 429].includes(err.status));
      if (limited) pausedUntil = Date.now() + PAUSE_MS;
      throw err instanceof SocradarUnavailable ? err : new SocradarUnavailable(`SOCRadar: ${(err as Error).message}`);
    }
  });
}
