import { route } from "@/lib/http";
import { createAttempt, listAttempts } from "@/lib/services/attempts";

export const GET = route((ctx) => ({ attempts: listAttempts(ctx.db, ctx.requireUser().id) }));
export const POST = route(async (ctx) => ({ attempt: createAttempt(ctx.db, ctx.requireUser().id, await ctx.json()) }));
