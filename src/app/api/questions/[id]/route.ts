import { route } from "@/lib/http";
import { getPracticableQuestion } from "@/lib/services/questions";

export const GET = route(async (ctx, p) => {
  ctx.requireUser();
  return { question: (await getPracticableQuestion(ctx.db, p.id)) };
});
