/**
 * GET /api/scan?domain=example.com
 * Runs ALL checks for one domain and returns them with the overall score
 * and the prioritised list of questions to send the vendor.
 * Handy for scripts and integrations (e.g. a procurement workflow).
 */
import { badRequest, jsonResult } from "@/lib/api/respond";
import { checkMeta, checks } from "@/lib/checks/registry";
import { runCheck } from "@/lib/checks/runner";
import { normalizeDomain } from "@/lib/domain";
import { collectFollowUps } from "@/lib/questionnaire";
import { overallScore } from "@/lib/scoring";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(req: Request) {
  const domain = normalizeDomain(new URL(req.url).searchParams.get("domain") ?? "");
  if (!domain) return badRequest("Provide a valid domain, e.g. ?domain=example.com");

  const results = await Promise.all(checks.map((c) => runCheck(c, domain)));
  const overall = overallScore(results, checkMeta());
  return jsonResult({ domain, overall, followUps: collectFollowUps(results), results }, results);
}
