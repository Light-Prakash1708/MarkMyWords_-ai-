import { route } from "@/lib/http";
import { disputeDetail, requireStaff, resolveDispute } from "@/lib/services/admin";

export const GET = route((ctx, p) => disputeDetail(ctx.db, requireStaff(ctx.user), p.id));
export const POST = route(async (ctx, p) => {
  (await resolveDispute(ctx.db, requireStaff(ctx.user), p.id, await ctx.json()));
  return { ok: true };
});
