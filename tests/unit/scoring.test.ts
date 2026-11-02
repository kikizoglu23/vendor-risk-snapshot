import { describe, expect, it } from "vitest";
import type { CheckResult, Finding } from "@/lib/checks/types";
import { checkMeta } from "@/lib/checks/registry";
import { CRITICAL_CAP, gradeFor, overallScore } from "@/lib/scoring";

const checks = [
  { id: "a", weight: 50 },
  { id: "b", weight: 30 },
  { id: "c", weight: 20 },
];

function r(checkId: string, score: number | null, findings: Finding[] = []): CheckResult {
  return {
    checkId,
    domain: "acme.com",
    status: score === null ? "error" : "pass",
    score,
    summary: "",
    findings,
    followUps: [],
    durationMs: 1,
    checkedAt: "",
  };
}

describe("gradeFor", () => {
  it.each([
    [100, "A"], [90, "A"], [89, "B"], [75, "B"], [74, "C"], [60, "C"], [59, "D"], [40, "D"], [39, "F"], [0, "F"],
  ])("%i → %s", (score, grade) => {
    expect(gradeFor(score)).toBe(grade);
  });
});

describe("overallScore", () => {
  it("computes the weighted average", () => {
    // (100*50 + 50*30 + 0*20) / 100 = 65
    expect(overallScore([r("a", 100), r("b", 50), r("c", 0)], checks)).toMatchObject({ score: 65, grade: "C", capped: false, scoredChecks: 3 });
  });

  it("leaves errored checks out instead of counting them as zero", () => {
    // (100*50 + 50*30) / 80 = 81.25 → 81
    expect(overallScore([r("a", 100), r("b", 50), r("c", null)], checks)).toMatchObject({ score: 81, grade: "B", scoredChecks: 2 });
  });

  it("caps the score when any finding is critical", () => {
    const critical: Finding[] = [{ severity: "critical", title: "KEV" }];
    const o = overallScore([r("a", 100), r("b", 100), r("c", 0, critical)], checks);
    expect(o).toMatchObject({ score: CRITICAL_CAP, grade: "D", capped: true });
  });

  it("does not raise a score that is already below the cap", () => {
    const critical: Finding[] = [{ severity: "critical", title: "KEV" }];
    const o = overallScore([r("a", 0, critical), r("b", 0), r("c", 100)], checks);
    expect(o).toMatchObject({ score: 20, capped: false });
  });

  it("returns no score when nothing could be scored", () => {
    expect(overallScore([r("a", null), r("b", null)], checks)).toEqual({ score: null, grade: null, capped: false, scoredChecks: 0 });
    expect(overallScore([], checks).score).toBeNull();
  });
});

describe("registry", () => {
  it("has 4 checks with unique URL-safe ids and weights summing to 100", () => {
    const meta = checkMeta();
    expect(meta).toHaveLength(4);
    expect(new Set(meta.map((c) => c.id)).size).toBe(4);
    for (const c of meta) {
      expect(c.id).toMatch(/^[a-z0-9-]+$/);
      expect(c.sources.length).toBeGreaterThan(0);
      expect(c).not.toHaveProperty("run");
    }
    expect(meta.reduce((s, c) => s + c.weight, 0)).toBe(100);
  });
});
