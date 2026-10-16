import { z } from "zod";
import { route } from "@/lib/http";
import { reorderUploads } from "@/lib/services/attempts";

export const POST = route(async (ctx, p) => {
  const body = z.object({ order: z.array(z.string()) }).parse(await ctx.json());
  (await reorderUploads(ctx.db, ctx.requireUser().id, p.id, body.order));
  return { ok: true };
});
