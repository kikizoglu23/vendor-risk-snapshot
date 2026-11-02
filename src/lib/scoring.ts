/**
 * Overall vendor score.
 *
 * 1. Weighted average of the individual check scores (weights in each check).
 *    Checks that errored are left out instead of counting as zero.
 * 2. Critical-finding cap: if any check reports a CRITICAL finding (e.g. a
 *    ransomware listing in the last 12 months, or a CISA KEV vulnerability),
 *    the overall score cannot exceed 49 — a perfect email setup must not
 *    hide an active compromise.
 * 3. Grade: A ≥ 90, B ≥ 75, C ≥ 60, D ≥ 40, F below.
 */
import type { CheckMeta, CheckResult } from "./checks/types";

export const CRITICAL_CAP = 49;

export type Grade = "A" | "B" | "C" | "D" | "F";

export interface OverallScore {
  score: number | null;
  grade: Grade | null;
  capped: boolean;
  scoredChecks: number;
}

export function gradeFor(score: number): Grade {
  if (score >= 90) return "A";
  if (score >= 75) return "B";
  if (score >= 60) return "C";
  if (score >= 40) return "D";
  return "F";
}

export function overallScore(results: CheckResult[], checks: Pick<CheckMeta, "id" | "weight">[]): OverallScore {
  let weighted = 0;
  let totalWeight = 0;
  let critical = false;
  for (const r of results) {
    if (r.findings.some((f) => f.severity === "critical")) critical = true;
    if (r.score === null) continue;
    const weight = checks.find((c) => c.id === r.checkId)?.weight ?? 0;
    weighted += r.score * weight;
    totalWeight += weight;
  }
  if (totalWeight === 0) return { score: null, grade: null, capped: false, scoredChecks: 0 };
  let score = Math.round(weighted / totalWeight);
  const capped = critical && score > CRITICAL_CAP;
  if (capped) score = CRITICAL_CAP;
  return { score, grade: gradeFor(score), capped, scoredChecks: results.filter((r) => r.score !== null).length };
}
