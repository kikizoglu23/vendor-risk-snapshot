/**
 * Shared HTTP helper used by every data source:
 *  - identifying User-Agent (some APIs, e.g. HIBP, require one)
 *  - per-request timeout
 *  - automatic retry with backoff on rate limits (429) and temporary
 *    server errors (502/503/504), honouring the Retry-After header.
 */

export const USER_AGENT = "VendorRiskSnapshot/1.0 (public security posture checker)";

const RETRYABLE = new Set([429, 502, 503, 504]);

export class HttpError extends Error {
  constructor(
    public status: number,
    public url: string,
  ) {
    super(`HTTP ${status} from ${new URL(url).host}`);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function backoffMs(res: Response, attempt: number): number {
  const retryAfter = Number(res.headers.get("retry-after"));
  if (retryAfter > 0 && retryAfter <= 8) return retryAfter * 1000;
  return 1000 * 2 ** attempt + Math.random() * 500; // ~1s, ~2s
}

export async function fetchJson<T>(
  url: string,
  init: RequestInit & { timeoutMs?: number; retries?: number } = {},
): Promise<T> {
  const { timeoutMs = 10_000, retries = 2, headers, ...rest } = init;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      ...rest,
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "User-Agent": USER_AGENT, Accept: "application/json", ...headers },
    });
    if (res.ok) return (await res.json()) as T;
    if (attempt < retries && RETRYABLE.has(res.status)) {
      await sleep(backoffMs(res, attempt));
      continue;
    }
    throw new HttpError(res.status, url);
  }
}
