/**
 * DNS lookups over HTTPS (DoH). Uses Cloudflare's public resolver and falls
 * back to Google's if Cloudflare fails. Both return the same JSON format.
 */
import { fetchJson } from "../http";

const RESOLVERS = ["https://cloudflare-dns.com/dns-query", "https://dns.google/resolve"];

interface DohResponse {
  Status: number; // 0 = NOERROR, 3 = NXDOMAIN
  Answer?: { name: string; type: number; data: string }[];
}

const TYPE_CODES = { A: 1, TXT: 16, MX: 15 } as const;
type RecordType = keyof typeof TYPE_CODES;

export interface DnsAnswer {
  exists: boolean; // false when the name does not exist (NXDOMAIN)
  records: string[];
}

export async function resolve(name: string, type: RecordType): Promise<DnsAnswer> {
  let lastError: unknown;
  for (const base of RESOLVERS) {
    try {
      const url = `${base}?name=${encodeURIComponent(name)}&type=${type}`;
      const res = await fetchJson<DohResponse>(url, {
        headers: { Accept: "application/dns-json" },
        timeoutMs: 6_000,
      });
      if (res.Status !== 0 && res.Status !== 3) throw new Error(`DNS status ${res.Status}`);
      const records = (res.Answer ?? [])
        .filter((a) => a.type === TYPE_CODES[type])
        .map((a) => (type === "TXT" ? joinTxt(a.data) : a.data));
      return { exists: res.Status === 0, records };
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

/** TXT records arrive as one or more quoted chunks: "v=spf1 a" " -all". */
function joinTxt(data: string): string {
  const chunks = data.match(/"((?:[^"\\]|\\.)*)"/g);
  return chunks ? chunks.map((c) => c.slice(1, -1).replace(/\\"/g, '"')).join("") : data;
}
