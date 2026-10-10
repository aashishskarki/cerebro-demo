import { NextResponse, type NextRequest } from "next/server";
import { NAME } from "@/lib/mentions";
import { scan } from "@/lib/sources";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Best-effort only: each server instance keeps its own count. The CDN cache below does the heavy lifting.
const HOURLY_LIMIT = 12;
const hits = new Map<string, number[]>();

function limited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < 3_600_000);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();
  return recent.length > HOURLY_LIMIT;
}

function fail(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: { "cache-control": "no-store" } });
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const brand = (params.get("brand") || "").trim().replace(/\s+/g, " ");
  const terms = (params.get("terms") || "")
    .split(",")
    .map((t) => t.trim().replace(/\s+/g, " "))
    .filter(Boolean);

  if (!NAME.test(brand)) return fail("bad_brand", 400);
  if (terms.length > 2 || terms.some((t) => !NAME.test(t))) return fail("bad_terms", 400);

  const ip = (request.headers.get("x-forwarded-for") || "unknown").split(",")[0].trim();
  if (limited(ip)) return fail("rate_limited", 429);

  try {
    const parts = await scan(brand, terms);
    if (parts.every((p) => p.sources.every((s) => !s.ok))) return fail("sources_down", 502);
    // The same brand asked again within the hour is served from the CDN without touching the sources;
    // a visitor's own browser reuses its copy for five minutes.
    return NextResponse.json({ parts }, {
      headers: { "cache-control": "public, max-age=300, s-maxage=3600" },
    });
  } catch {
    return fail("scan_failed", 500);
  }
}
