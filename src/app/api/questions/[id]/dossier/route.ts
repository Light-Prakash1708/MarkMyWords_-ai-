import { route } from "@/lib/http";
import { getDossier, getPracticableQuestion } from "@/lib/services/questions";

export const GET = route((ctx, p) => {
  const u = ctx.requireUser();
  const q = getPracticableQuestion(ctx.db, p.id);
  return getDossier(ctx.db, u.id, q.id);
});
