import { route } from "@/lib/http";
import { markSourceVerified, requireStaff } from "@/lib/services/admin";

export const POST = route(async (ctx, p) => {
  markSourceVerified(ctx.db, requireStaff(ctx.user), p.id, await ctx.json());
  return { ok: true };
});
