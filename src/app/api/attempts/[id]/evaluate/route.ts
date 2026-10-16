import { route } from "@/lib/http";
import { requestEvaluation } from "@/lib/services/evaluations";

export const POST = route((ctx, p) => ({ evaluation: requestEvaluation(ctx.db, ctx.requireUser().id, p.id) }));
