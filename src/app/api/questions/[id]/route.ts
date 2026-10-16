import { route } from "@/lib/http";
import { getPracticableQuestion } from "@/lib/services/questions";

export const GET = route((ctx, p) => {
  ctx.requireUser();
  return { question: getPracticableQuestion(ctx.db, p.id) };
});
