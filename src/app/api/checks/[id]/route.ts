/**
 * GET /api/checks/{id}?domain=example.com
 * Runs ONE check against ONE domain. Each check is an independent endpoint,
 * so the UI can run them in parallel and show results as they arrive.
 */
import { badRequest, jsonResult } from "@/lib/api/respond";
import { getCheck } from "@/lib/checks/registry";
import { runCheck } from "@/lib/checks/runner";
import { normalizeDomain } from "@/lib/domain";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const check = getCheck(id);
  if (!check) return badRequest(`Unknown check "${id}". See /api/checks for the list.`, 404);

  const domain = normalizeDomain(new URL(req.url).searchParams.get("domain") ?? "");
  if (!domain) return badRequest("Provide a valid domain, e.g. ?domain=example.com");

  const result = await runCheck(check, domain);
  return jsonResult(result, [result]);
}
