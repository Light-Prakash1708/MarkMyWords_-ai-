import { route } from "@/lib/http";
import { getEvaluationForUser } from "@/lib/services/evaluations";

export const GET = route(async (ctx, p) => ({ evaluation: (await getEvaluationForUser(ctx.db, ctx.requireUser().id, p.id)) }));
