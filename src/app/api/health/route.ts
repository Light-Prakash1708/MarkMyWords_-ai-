import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

export async function GET() {
  const db = (await getDb());
  const env = getEnv();
  const ok = ((await db.get("SELECT COUNT(*) AS n FROM exams")) as { n: number }).n > 0;
  return NextResponse.json({ ok, provider: env.provider, ocr: env.ocrProvider, demo_mode: env.demoMode });
}
