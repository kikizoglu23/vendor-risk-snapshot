/**
 * Error isolation. Uses live DNS for the "does the domain exist" guard.
 */
import { describe, expect, it, vi } from "vitest";
import { runCheck } from "@/lib/checks/runner";
import type { CheckDefinition } from "@/lib/checks/types";

function fakeCheck(run: CheckDefinition["run"]): CheckDefinition {
  return { id: "fake", name: "Fake", shortName: "Fake", question: "", whyItMatters: "", weight: 1, sources: [], limitations: "", run };
}

describe("runCheck", () => {
  it("adds metadata to a successful outcome", async () => {
    const res = await runCheck(fakeCheck(async () => ({ status: "pass", score: 100, summary: "ok", findings: [] })), "example.com");
    expect(res).toMatchObject({ checkId: "fake", domain: "example.com", status: "pass", score: 100 });
    expect(res.durationMs).toBeGreaterThanOrEqual(0);
    expect(Date.parse(res.checkedAt)).not.toBeNaN();
  });

  it("turns a crashing data source into an 'error' result", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await runCheck(fakeCheck(async () => { throw new Error("HTTP 503 from api.example"); }), "example.com");
    expect(res).toMatchObject({ status: "error", score: null });
    expect(res.summary).toContain("HTTP 503");
  });

  it("times out a hanging data source", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await runCheck(fakeCheck(() => new Promise(() => {})), "example.com", 300);
    expect(res).toMatchObject({ status: "error", score: null });
    expect(res.summary).toContain("timed out");
  });

  it("does not run the check at all for a non-existent domain", async () => {
    const run = vi.fn();
    const res = await runCheck(fakeCheck(run), "this-domain-does-not-exist-vrs-test.com");
    expect(run).not.toHaveBeenCalled();
    expect(res).toMatchObject({ status: "error", score: null, summary: "This domain does not exist — check the spelling." });
  });
});
