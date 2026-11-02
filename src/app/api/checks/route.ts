/** GET /api/checks — lists every available check and its metadata. */
import { NextResponse } from "next/server";
import { checkMeta } from "@/lib/checks/registry";

export function GET() {
  return NextResponse.json({ checks: checkMeta() });
}
