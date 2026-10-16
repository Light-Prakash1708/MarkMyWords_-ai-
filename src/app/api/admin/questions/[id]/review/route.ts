import { route } from "@/lib/http";
import { requireStaff, reviewQuestion } from "@/lib/services/admin";

export const POST = route(async (ctx, p) => {
  (await reviewQuestion(ctx.db, requireStaff(ctx.user), p.id, await ctx.json()));
  return { ok: true };
});
