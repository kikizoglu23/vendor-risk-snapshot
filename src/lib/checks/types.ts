/**
 * The contract every check must follow.
 *
 * A "check" is a self-contained module that answers ONE question about a
 * vendor's domain (e.g. "Has this vendor been listed on a ransomware leak
 * site?"). To add a new check: create a file in this folder that exports a
 * `CheckDefinition`, then add it to `registry.ts`. Nothing else changes —
 * the API endpoint, the UI and the overall score pick it up automatically.
 */

export type CheckStatus = "pass" | "warn" | "fail" | "error";

export type Severity = "info" | "low" | "medium" | "high" | "critical";

export interface Finding {
  severity: Severity;
  title: string;
  detail?: string;
  link?: string;
  /** Optional "go deeper" link, e.g. to the CVE's page on SOCRadar CVE Radar. */
  related?: { label: string; url: string };
}

export type Priority = "critical" | "high" | "medium" | "low";

/** A question to send the vendor, generated from a finding. */
export interface FollowUp {
  priority: Priority;
  question: string;
  /** Link to the public evidence behind the question. */
  evidence?: string;
}

export interface SourceRef {
  name: string;
  url: string;
}

/** What a check's `run` function returns. */
export interface CheckOutcome {
  status: CheckStatus;
  /** 0 (worst) – 100 (best). `null` when the check could not produce a score. */
  score: number | null;
  /** One-sentence, human-readable verdict. */
  summary: string;
  findings: Finding[];
  /** Raw, structured data for API consumers and CSV export. */
  data?: Record<string, unknown>;
}

/** What the API returns: the outcome plus metadata added by the runner. */
export interface CheckResult extends CheckOutcome {
  checkId: string;
  /** Questions to send the vendor about this check's findings. */
  followUps: FollowUp[];
  domain: string;
  durationMs: number;
  checkedAt: string;
}

export interface CheckDefinition {
  /** URL-safe id, used in /api/checks/{id}. */
  id: string;
  name: string;
  /** Short label for table column headers. */
  shortName: string;
  /** The question this check answers, shown in the UI. */
  question: string;
  /** Why a security / procurement team should care. */
  whyItMatters: string;
  /** Relative importance in the overall score. */
  weight: number;
  sources: SourceRef[];
  /** Known blind spots, shown in the methodology section. */
  limitations: string;
  run: (domain: string) => Promise<CheckOutcome>;
  /**
   * Optional: turn the outcome into questions for the vendor. Pure function of
   * the outcome (no network), so it is easy to test.
   */
  followUps?: (outcome: CheckOutcome, domain: string) => FollowUp[];
}

/** The public, serialisable part of a check (no functions). */
export type CheckMeta = Omit<CheckDefinition, "run" | "followUps">;
