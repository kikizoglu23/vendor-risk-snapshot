/**
 * Turns whatever the user typed ("https://www.Acme.com/about",
 * "jane@acme.com", "acme.com.") into a clean domain ("acme.com"),
 * or returns null if it isn't a valid public domain name.
 */
export function normalizeDomain(input: string): string | null {
  let s = input.trim().toLowerCase();
  if (!s) return null;
  if (s.includes("@")) s = s.split("@").pop()!;
  if (!/^[a-z][a-z0-9+.-]*:\/\//.test(s)) s = `http://${s}`;
  let host: string;
  try {
    host = new URL(s).hostname; // also converts IDNs to punycode
  } catch {
    return null;
  }
  host = host.replace(/\.$/, "").replace(/^www\./, "");
  const valid =
    host.length <= 253 &&
    /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/.test(host);
  return valid ? host : null;
}

/** Common two-part public suffixes such as co.uk or com.tr. */
const SECOND_LEVEL = new Set(["co", "com", "net", "org", "gov", "edu", "ac", "gen", "biz", "info"]);

/**
 * The organisation's "brand" label: acme.com → acme, acme.com.tr → acme,
 * shop.acme.co.uk → acme. Used for name-based searches.
 */
export function brandLabel(domain: string): string {
  const parts = domain.split(".");
  if (parts.length >= 3 && parts.at(-1)!.length === 2 && SECOND_LEVEL.has(parts.at(-2)!)) {
    return parts.at(-3)!;
  }
  return parts.length >= 2 ? parts.at(-2)! : parts[0];
}
