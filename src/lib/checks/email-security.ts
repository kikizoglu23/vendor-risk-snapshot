/**
 * CHECK 3, Email spoofing protection (SPF + DMARC)
 *
 * SPF  = a DNS record listing which servers may send email for the domain.
 * DMARC = a DNS record telling receivers what to do with email that fails
 *         those checks: nothing (p=none), spam folder (quarantine) or block (reject).
 *
 * Without them, anyone can send email that looks like it came from the
 * vendor, the classic setup for invoice fraud against the vendor's customers.
 *
 * Score = SPF (max 40) + DMARC (max 60).
 */
import { resolve } from "../sources/dns";
import type { CheckDefinition, Finding, FollowUp } from "./types";

export function scoreSpf(records: string[]): { points: number; finding: Finding } {
  const spf = records.filter((r) => r.toLowerCase().startsWith("v=spf1"));
  if (spf.length === 0) {
    return { points: 0, finding: { severity: "high", title: "No SPF record", detail: "Receivers cannot tell which servers are allowed to send email for this domain." } };
  }
  if (spf.length > 1) {
    return { points: 10, finding: { severity: "medium", title: "Multiple SPF records (invalid)", detail: "RFC 7208 allows only one SPF record; receivers may treat SPF as broken." } };
  }
  const record = spf[0];
  const all = record.match(/([-~?+])?all\b/i);
  const qualifier = all ? (all[1] ?? "+") : null;
  const map: Record<string, { points: number; severity: Finding["severity"]; text: string }> = {
    "-": { points: 40, severity: "info", text: "Strict: unlisted servers are rejected (-all)." },
    "~": { points: 30, severity: "low", text: "Soft-fail: unlisted servers are marked suspicious (~all)." },
    "?": { points: 10, severity: "medium", text: "Neutral: unlisted servers are neither allowed nor blocked (?all)." },
    "+": { points: 0, severity: "high", text: "Allows ANY server to send for this domain (+all)." },
  };
  if (!qualifier) {
    return { points: 20, finding: { severity: "low", title: "SPF record has no 'all' rule", detail: record } };
  }
  const m = map[qualifier];
  return { points: m.points, finding: { severity: m.severity, title: `SPF: ${m.text}`, detail: record } };
}

export function scoreDmarc(records: string[]): { points: number; finding: Finding } {
  const dmarc = records.find((r) => r.toLowerCase().startsWith("v=dmarc1"));
  if (!dmarc) {
    return { points: 0, finding: { severity: "high", title: "No DMARC record", detail: "Spoofed emails using this domain will usually be delivered." } };
  }
  const tags = Object.fromEntries(
    dmarc.split(";").map((t) => t.trim().split("=").map((s) => s.trim().toLowerCase())).filter((t) => t.length === 2),
  );
  const policy = tags.p ?? "none";
  const pct = tags.pct ? Number(tags.pct) : 100;
  if (policy === "reject" && pct >= 100) {
    return { points: 60, finding: { severity: "info", title: "DMARC: spoofed email is rejected (p=reject)", detail: dmarc } };
  }
  if (policy === "reject" || policy === "quarantine") {
    const partial = pct < 100;
    return {
      points: partial ? 40 : 50,
      finding: {
        severity: partial ? "medium" : "low",
        title: `DMARC: ${policy}${partial ? ` applied to only ${pct}% of email` : ", so spoofed email goes to spam"}`,
        detail: dmarc,
      },
    };
  }
  return { points: 20, finding: { severity: "medium", title: "DMARC in monitor-only mode (p=none)", detail: `Spoofed email is reported but still delivered. ${dmarc}` } };
}

export const emailSecurityCheck: CheckDefinition = {
  id: "email-security",
  name: "Email spoofing protection",
  shortName: "Email spoofing",
  question: "Can attackers easily send email pretending to be this vendor?",
  whyItMatters:
    "Business email compromise and fake-invoice fraud start with spoofed emails. If a vendor's domain has weak SPF/DMARC, criminals can email your finance team 'from' that vendor.",
  weight: 20,
  sources: [
    { name: "Cloudflare DNS-over-HTTPS", url: "https://developers.cloudflare.com/1.1.1.1/encryption/dns-over-https/" },
    { name: "Google Public DNS", url: "https://developers.google.com/speed/public-dns/docs/doh" },
  ],
  limitations:
    "Checks the published DNS policy, not how strictly the vendor's mail servers enforce it.",

  async run(domain) {
    const [txt, dmarcTxt] = await Promise.all([resolve(domain, "TXT"), resolve(`_dmarc.${domain}`, "TXT")]);
    if (!txt.exists) {
      return { status: "error", score: null, summary: "Domain does not exist in DNS.", findings: [] };
    }
    const spf = scoreSpf(txt.records);
    const dmarc = scoreDmarc(dmarcTxt.records);
    const score = spf.points + dmarc.points;
    const status = score >= 80 ? "pass" : score >= 50 ? "warn" : "fail";
    const summary =
      status === "pass"
        ? "Strong protection: spoofed emails are likely to be blocked."
        : status === "warn"
          ? "Partial protection: some spoofed emails may still reach inboxes."
          : "Weak protection: this domain is easy to spoof in phishing emails.";
    return {
      status,
      score,
      summary,
      findings: [spf.finding, dmarc.finding],
      data: { spfPoints: spf.points, dmarcPoints: dmarc.points, spf: spf.finding.detail, dmarc: dmarc.finding.detail },
    };
  },


  followUps(outcome) {
    const { spfPoints = 40, dmarcPoints = 60 } = (outcome.data ?? {}) as { spfPoints?: number; dmarcPoints?: number };
    const out: FollowUp[] = [];
    if (dmarcPoints < 50) {
      const state =
        dmarcPoints === 0
          ? "Your domain has no DMARC record"
          : dmarcPoints === 20
            ? "Your DMARC policy is monitor-only (p=none)"
            : "Your DMARC policy is only applied to part of your email (pct below 100)";
      out.push({
        priority: "high",
        question: `${state}, so emails spoofing your domain are likely to be delivered. How do you protect customers from fake invoices or payment-change requests sent in your name, and when will you enforce p=quarantine or p=reject?`,
      });
    }
    if (spfPoints < 30) {
      out.push({
        priority: "medium",
        question:
          "Your SPF record is missing, invalid or permissive. Which mail servers and services are authorised to send email for your domain, and will you publish a strict SPF policy?",
      });
    }
    if (out.length > 0) {
      out.push({
        priority: "medium",
        question: "What out-of-band process should our finance team use to verify any request from you to change bank details?",
      });
    }
    return out;
  },
};
