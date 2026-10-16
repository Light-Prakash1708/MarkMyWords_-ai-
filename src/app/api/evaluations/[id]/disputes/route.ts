import { route } from "@/lib/http";
import { createDispute, listDisputesForUser } from "@/lib/services/evaluations";

export const GET = route((ctx, p) => ({ disputes: listDisputesForUser(ctx.db, ctx.requireUser().id, p.id) }));
export const POST = route(async (ctx, p) => ({ dispute: createDispute(ctx.db, ctx.requireUser().id, p.id, await ctx.json()) }));
