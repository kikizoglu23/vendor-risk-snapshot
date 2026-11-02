import { NextResponse } from "next/server";
import type { CheckResult } from "../checks/types";

/** Successful results are cached at the edge for 1 hour to go easy on free APIs. */
export function jsonResult(body: unknown, results: CheckResult[]) {
  const ok = results.every((r) => r.status !== "error");
  return NextResponse.json(body, {
    headers: {
      "Cache-Control": ok ? "public, s-maxage=3600, stale-while-revalidate=86400" : "no-store",
    },
  });
}

export function badRequest(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}
