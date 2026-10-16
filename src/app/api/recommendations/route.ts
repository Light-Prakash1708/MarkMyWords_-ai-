import { route } from "@/lib/http";
import { recommendNext } from "@/lib/services/skills";

export const GET = route(async (ctx) => ({ recommendations: (await recommendNext(ctx.db, ctx.requireUser().id)) }));
