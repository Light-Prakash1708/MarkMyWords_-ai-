import { route } from "@/lib/http";
import { getOwnedAttempt, submitHandwritten, submitTyped } from "@/lib/services/attempts";

export const POST = route(async (ctx, p) => {
  const u = ctx.requireUser();
  const a = (await getOwnedAttempt(ctx.db, u.id, p.id));
  const body = await ctx.json();
  return { attempt: a.mode === "typed" ? (await submitTyped(ctx.db, u.id, a.id, body)) : (await submitHandwritten(ctx.db, u.id, a.id, body)) };
});

// LLM work runs in this request or right after it (after()); allow time on serverless.
export const maxDuration = 300;
