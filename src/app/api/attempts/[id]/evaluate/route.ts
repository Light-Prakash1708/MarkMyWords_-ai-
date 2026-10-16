import { route } from "@/lib/http";
import { requestEvaluation } from "@/lib/services/evaluations";

export const POST = route(async (ctx, p) => ({ evaluation: (await requestEvaluation(ctx.db, ctx.requireUser().id, p.id)) }));

// LLM work runs in this request or right after it (after()); allow time on serverless.
export const maxDuration = 300;
