import { route } from "@/lib/http";
import { confirmTranscript } from "@/lib/services/attempts";

export const POST = route(async (ctx, p) => ({ attempt: confirmTranscript(ctx.db, ctx.requireUser().id, p.id, await ctx.json()) }));
