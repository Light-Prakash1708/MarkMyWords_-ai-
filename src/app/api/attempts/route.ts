import { route } from "@/lib/http";
import { createAttempt, listAttempts } from "@/lib/services/attempts";

export const GET = route(async (ctx) => ({ attempts: (await listAttempts(ctx.db, ctx.requireUser().id)) }));
export const POST = route(async (ctx) => ({ attempt: (await createAttempt(ctx.db, ctx.requireUser().id, await ctx.json())) }));
