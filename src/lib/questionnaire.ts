/**
 * Vendor questionnaire: turns every check's follow-up questions into one
 * prioritised list and a ready-to-send email. A security / procurement team
 * can paste it straight into a message to the vendor.
 */
import type { CheckResult, FollowUp, Priority } from "./checks/types";

const ORDER: Record<Priority, number> = { critical: 0, high: 1, medium: 2, low: 3 };

/** All follow-ups across checks, most urgent first, without duplicates. */
export function collectFollowUps(results: CheckResult[]): FollowUp[] {
  const seen = new Set<string>();
  return results
    .flatMap((r) => r.followUps ?? [])
    .filter((f) => !seen.has(f.question) && seen.add(f.question))
    .sort((a, b) => ORDER[a.priority] - ORDER[b.priority]);
}

function addDays(date: Date, days: number): string {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

/** Plain-text email the user can copy into their mail client. */
export function emailDraft(
  domain: string,
  followUps: FollowUp[],
  { now = new Date(), reportUrl }: { now?: Date; reportUrl?: string } = {},
): string {
  const checkedOn = now.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const questions = followUps
    .map((f, i) => `${i + 1}. ${f.question}${f.evidence ? `\n   Evidence: ${f.evidence}` : ""}`)
    .join("\n\n");
  return [
    `Subject: Security follow-up for ${domain}`,
    "",
    "Hello,",
    "",
    `As part of our vendor security review, we ran a passive check of ${domain} against public threat-intelligence sources on ${checkedOn}. A few items need clarification before we proceed:`,
    "",
    questions,
    "",
    ...(reportUrl ? [`The full report, with the public evidence behind each item, is here:\n${reportUrl}`, ""] : []),
    `We would appreciate a written response by ${addDays(now, 10)}. If any finding is inaccurate or already resolved, please let us know. Public sources can lag behind remediation.`,
    "",
    "Thank you,",
  ].join("\n");
}
