import { route } from "@/lib/http";
import { getOwnedAttempt, submitHandwritten, submitTyped } from "@/lib/services/attempts";

export const POST = route(async (ctx, p) => {
  const u = ctx.requireUser();
  const a = getOwnedAttempt(ctx.db, u.id, p.id);
  const body = await ctx.json();
  return { attempt: a.mode === "typed" ? submitTyped(ctx.db, u.id, a.id, body) : submitHandwritten(ctx.db, u.id, a.id, body) };
});
