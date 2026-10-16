import { route } from "@/lib/http";
import { getEvaluationForUser } from "@/lib/services/evaluations";

export const GET = route((ctx, p) => ({ evaluation: getEvaluationForUser(ctx.db, ctx.requireUser().id, p.id) }));
