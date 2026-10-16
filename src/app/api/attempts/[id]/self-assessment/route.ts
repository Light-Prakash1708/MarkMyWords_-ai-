import { route } from "@/lib/http";
import { saveSelfAssessment } from "@/lib/services/attempts";

export const POST = route(async (ctx, p) => {
  saveSelfAssessment(ctx.db, ctx.requireUser().id, p.id, await ctx.json());
  return { ok: true };
});
