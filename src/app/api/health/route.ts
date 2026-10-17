import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

/** Public health check. Reports configuration modes only — never keys, URLs or tokens. */
export async function GET() {
  const env = getEnv();
  try {
    const db = await getDb();
    const ok = ((await db.get("SELECT COUNT(*) AS n FROM exams")) as { n: number }).n > 0;
    return NextResponse.json({
      ok,
      storage: env.dbUrl.startsWith("libsql:") || env.dbUrl.startsWith("https:") || env.dbUrl.startsWith("wss:") ? "hosted" : env.ephemeralStorage ? "ephemeral" : "local",
      provider: env.provider,
      ocr: env.ocrProvider,
      judge_model: env.provider === "heuristic" ? null : env.judgeModel,
      demo_mode: env.demoMode,
    });
  } catch (e) {
    console.error("[mmw] health: database unavailable:", (e as Error)?.message);
    return NextResponse.json({ ok: false, error: "database_unavailable" }, { status: 503 });
  }
}
