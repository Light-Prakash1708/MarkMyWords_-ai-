import { route } from "@/lib/http";
import { updateProfile } from "@/lib/services/users";

export const POST = route(async (ctx) => {
  updateProfile(ctx.db, ctx.requireUser().id, await ctx.json());
  return { ok: true };
});
