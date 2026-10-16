import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

export function GET() {
  const db = getDb();
  const env = getEnv();
  const ok = (db.prepare("SELECT COUNT(*) AS n FROM exams").get() as { n: number }).n > 0;
  return NextResponse.json({ ok, provider: env.provider, ocr: env.ocrProvider, demo_mode: env.demoMode });
}
