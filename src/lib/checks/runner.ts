/**
 * Runs a single check safely: measures time, enforces a timeout and turns
 * any crash (API down, bad response) into an "error" result instead of
 * breaking the whole report. One failing data source never hides the others.
 */
import { resolve } from "../sources/dns";
import type { CheckDefinition, CheckResult } from "./types";

export const TIMEOUT_MS = 25_000;

/**
 * Guard against typos: a domain that doesn't exist in DNS would otherwise
 * "pass" the database checks (nothing found) and get a misleading A grade.
 * Cached briefly because every check for a domain asks the same question.
 */
const existsCache = new Map<string, { at: number; exists: boolean }>();
async function domainExists(domain: string): Promise<boolean> {
  const hit = existsCache.get(domain);
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.exists;
  const { exists } = await resolve(domain, "A");
  existsCache.set(domain, { at: Date.now(), exists });
  return exists;
}

export async function runCheck(check: CheckDefinition, domain: string, timeoutMs = TIMEOUT_MS): Promise<CheckResult> {
  const started = Date.now();
  const meta = { checkId: check.id, domain, checkedAt: new Date().toISOString() };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    if (!(await domainExists(domain))) {
      return {
        ...meta,
        status: "error",
        score: null,
        summary: "This domain does not exist — check the spelling.",
        findings: [],
        followUps: [],
        durationMs: Date.now() - started,
      };
    }
    const outcome = await Promise.race([
      check.run(domain),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Check timed out")), timeoutMs);
      }),
    ]);
    const followUps = outcome.status === "error" ? [] : (check.followUps?.(outcome, domain) ?? []);
    return { ...meta, ...outcome, followUps, durationMs: Date.now() - started };
  } catch (err) {
    console.error(`[check:${check.id}] ${domain}:`, err);
    return {
      ...meta,
      status: "error",
      score: null,
      summary: `Data source unavailable right now (${err instanceof Error ? err.message : "unknown error"}). Try again later.`,
      findings: [],
      followUps: [],
      durationMs: Date.now() - started,
    };
  } finally {
    clearTimeout(timer);
  }
}
