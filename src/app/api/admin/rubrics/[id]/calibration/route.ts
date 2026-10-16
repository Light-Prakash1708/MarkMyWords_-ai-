import { z } from "zod";
import { route } from "@/lib/http";
import { attachCalibrationReport, requireAdmin } from "@/lib/services/admin";

export const POST = route(async (ctx, p) => {
  const u = requireAdmin(ctx.user);
  const body = z.object({ report: z.record(z.string(), z.unknown()), human_reviewed_cases: z.number().int().min(0) }).parse(await ctx.json());
  return { id: (await attachCalibrationReport(ctx.db, u, p.id, body.report, body.human_reviewed_cases)) };
});
