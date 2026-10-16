import { route } from "@/lib/http";
import { getDossier, getPracticableQuestion } from "@/lib/services/questions";

export const GET = route(async (ctx, p) => {
  const u = ctx.requireUser();
  const q = (await getPracticableQuestion(ctx.db, p.id));
  return getDossier(ctx.db, u.id, q.id);
});
