import { route } from "@/lib/http";
import { getLadder, revealRung } from "@/lib/services/hints";

export const GET = route((ctx, p) => getLadder(ctx.db, ctx.requireUser().id, p.id));
export const POST = route(async (ctx, p) => {
  const u = ctx.requireUser();
  const revealed = await revealRung(ctx.db, u.id, p.id, await ctx.json());
  return { revealed, ladder: (await getLadder(ctx.db, u.id, p.id)) };
});

// LLM work runs in this request or right after it (after()); allow time on serverless.
export const maxDuration = 300;
