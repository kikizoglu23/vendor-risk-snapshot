/**
 * CHECK 4 — Internet-exposed services & exploited vulnerabilities
 *
 * 1. Resolve the vendor's domain (and www.) to IP addresses via DNS.
 * 2. Look each IP up in Shodan InternetDB (free, no key): open ports and
 *    CVEs associated with the software versions Shodan saw on that IP.
 * 3. Cross-reference those CVEs with CISA KEV (confirmed exploited in the
 *    wild) and FIRST EPSS (probability of exploitation in the next 30 days).
 *
 * This is fully passive: we never connect to the vendor's servers ourselves.
 */
import { cached } from "../cache";
import { fetchJson, HttpError } from "../http";
import { resolve } from "../sources/dns";
import { getEpss } from "../sources/epss";
import { getKev } from "../sources/kev";
import type { CheckDefinition, Finding, FollowUp } from "./types";

const INTERNETDB = "https://internetdb.shodan.io";

/** Services that should almost never be reachable from the internet. */
const RISKY_PORTS: Record<number, string> = {
  21: "FTP",
  23: "Telnet",
  445: "SMB (Windows file sharing)",
  1433: "Microsoft SQL Server",
  3306: "MySQL",
  3389: "Remote Desktop (RDP)",
  5432: "PostgreSQL",
  5900: "VNC remote control",
  6379: "Redis",
  9200: "Elasticsearch",
  11211: "Memcached",
  27017: "MongoDB",
};

interface InternetDbHost {
  ip: string;
  ports: number[];
  vulns: string[];
  tags: string[];
  hostnames: string[];
}

async function lookup(ip: string): Promise<InternetDbHost | null> {
  try {
    return await cached(`internetdb:${ip}`, 60 * 60 * 1000, () => fetchJson<InternetDbHost>(`${INTERNETDB}/${ip}`));
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) return null; // no data for this IP
    throw err;
  }
}

export const exposedServicesCheck: CheckDefinition = {
  id: "exposed-services",
  name: "Exposed services & exploited CVEs",
  shortName: "Exposure",
  question: "Do this vendor's servers expose risky services or known-exploited vulnerabilities?",
  whyItMatters:
    "Attackers mass-scan the internet for exactly these weaknesses. A vulnerability on CISA's KEV list is being used in real attacks right now; an exposed database or RDP port is a common ransomware entry point.",
  weight: 25,
  sources: [
    { name: "Shodan InternetDB", url: "https://internetdb.shodan.io" },
    { name: "CISA KEV catalog", url: "https://www.cisa.gov/known-exploited-vulnerabilities-catalog" },
    { name: "FIRST EPSS", url: "https://www.first.org/epss/" },
  ],
  limitations:
    "Only checks the main website IPs (domain and www), not every server the vendor owns. CVEs are inferred from software versions Shodan observed and may be false positives if the vendor backported a patch. Sites behind a CDN show the CDN's edge, not the origin server.",

  async run(domain) {
    const [apex, www] = await Promise.all([resolve(domain, "A"), resolve(`www.${domain}`, "A")]);
    const ips = [...new Set([...apex.records, ...www.records])]
      .filter((ip) => /^\d{1,3}(\.\d{1,3}){3}$/.test(ip))
      .slice(0, 5);
    if (ips.length === 0) {
      return { status: "error", score: null, summary: "Domain has no web server IP address to check.", findings: [] };
    }

    const hosts = (await Promise.all(ips.map(lookup))).filter((h): h is InternetDbHost => h !== null);
    const ports = [...new Set(hosts.flatMap((h) => h.ports))].sort((a, b) => a - b);
    const cves = [...new Set(hosts.flatMap((h) => h.vulns.map((v) => v.toUpperCase())))];
    const behindCdn = hosts.some((h) => h.tags.includes("cdn"));

    const [kev, epss] = await Promise.all([
      cves.length ? getKev() : Promise.resolve(new Map()),
      cves.length ? getEpss(cves).catch(() => new Map<string, number>()) : Promise.resolve(new Map<string, number>()),
    ]);

    const kevHits = cves.filter((c) => kev.has(c));
    const highEpss = cves.filter((c) => !kev.has(c) && (epss.get(c) ?? 0) >= 0.5);
    const otherCves = cves.filter((c) => !kevHits.includes(c) && !highEpss.includes(c));
    const riskyOpen = ports.filter((p) => p in RISKY_PORTS);

    const findings: Finding[] = [];
    for (const c of kevHits) {
      const k = kev.get(c)!;
      findings.push({
        severity: "critical",
        title: `${c} — on CISA's Known Exploited list`,
        detail: `${k.vulnerabilityName} (${k.vendorProject} ${k.product}). Added ${k.dateAdded}.${k.knownRansomwareCampaignUse === "Known" ? " Used in ransomware campaigns." : ""}${epss.has(c) ? ` EPSS ${(epss.get(c)! * 100).toFixed(1)}%.` : ""}`,
        link: `https://nvd.nist.gov/vuln/detail/${c}`,
        related: { label: "SOCRadar CVE Radar", url: `https://socradar.io/free-tools/cve-radar/${c}` },
      });
    }
    for (const c of highEpss) {
      findings.push({
        severity: "high",
        title: `${c} — ${(epss.get(c)! * 100).toFixed(1)}% chance of exploitation in 30 days (EPSS)`,
        link: `https://nvd.nist.gov/vuln/detail/${c}`,
        related: { label: "SOCRadar CVE Radar", url: `https://socradar.io/free-tools/cve-radar/${c}` },
      });
    }
    for (const p of riskyOpen) {
      findings.push({
        severity: "high",
        title: `Port ${p} open — ${RISKY_PORTS[p]}`,
        detail: "This service is rarely meant to be reachable from the internet.",
      });
    }
    if (otherCves.length) {
      findings.push({
        severity: "low",
        title: `${otherCves.length} other CVE(s) associated with detected software`,
        detail: otherCves.slice(0, 15).join(", ") + (otherCves.length > 15 ? " …" : ""),
      });
    }
    findings.push({
      severity: "info",
      title: `Checked ${ips.length} IP(s); open ports: ${ports.length ? ports.join(", ") : "none indexed"}`,
      detail: [ips.join(", "), behindCdn && "Site is behind a CDN — results reflect the CDN edge, not the origin server."]
        .filter(Boolean)
        .join(" · "),
    });

    // Start at 100, deduct per problem, never below 0.
    const score = Math.max(
      0,
      100 - 25 * kevHits.length - 10 * highEpss.length - 15 * riskyOpen.length - Math.min(20, 2 * otherCves.length),
    );
    const status = kevHits.length > 0 || score < 60 ? "fail" : score < 90 ? "warn" : "pass";
    const summary =
      kevHits.length > 0
        ? `${kevHits.length} known-exploited vulnerability(ies) (CISA KEV) on public servers.`
        : riskyOpen.length > 0
          ? `Risky service(s) exposed to the internet: ${riskyOpen.map((p) => RISKY_PORTS[p]).join(", ")}.`
          : cves.length > 0
            ? `${cves.length} potential CVE(s) on public servers; none known to be exploited.`
            : "No risky services or known vulnerabilities indexed on public servers.";

    return {
      status,
      score,
      summary,
      findings,
      data: {
        ips,
        ports,
        cves,
        kev: kevHits,
        kevDetails: kevHits.map((c) => ({
          cve: c,
          name: kev.get(c)!.vulnerabilityName,
          ransomware: kev.get(c)!.knownRansomwareCampaignUse === "Known",
        })),
        highEpss,
        riskyPorts: riskyOpen,
        behindCdn,
      },
    };
  },


  followUps(outcome) {
    const d = (outcome.data ?? {}) as {
      ips?: string[];
      kevDetails?: { cve: string; name: string; ransomware: boolean }[];
      highEpss?: string[];
      riskyPorts?: number[];
    };
    const where = d.ips?.length ? ` (${d.ips.join(", ")})` : "";
    const out: FollowUp[] = [];
    for (const k of (d.kevDetails ?? []).slice(0, 5)) {
      out.push({
        priority: "critical",
        question: `Your public web server${where} appears to run software affected by ${k.cve} (${k.name}), which CISA lists as actively exploited${k.ransomware ? " and used in ransomware campaigns" : ""}. Has it been patched or mitigated, and on what date?`,
        evidence: `https://nvd.nist.gov/vuln/detail/${k.cve}`,
      });
    }
    if (d.highEpss?.length) {
      out.push({
        priority: "high",
        question: `Your public web server${where} appears to be affected by ${d.highEpss.slice(0, 5).join(", ")}, which have a high predicted likelihood of exploitation (EPSS). What is your patch status for these?`,
      });
    }
    for (const p of d.riskyPorts ?? []) {
      out.push({
        priority: "high",
        question: `${RISKY_PORTS[p] ?? "A sensitive service"} (port ${p}) is reachable from the internet on your servers${where}. Is this intentional, and what restricts access to it (VPN, IP allow-list, MFA)?`,
      });
    }
    return out;
  },
};
