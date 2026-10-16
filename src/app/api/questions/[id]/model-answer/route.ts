import { route } from "@/lib/http";
import { assertAttemptedBefore, getPracticableQuestion } from "@/lib/services/questions";
import { AppError } from "@/lib/util/errors";

/**
 * P1 gate. There is deliberately no way to fetch a model answer, outline or exemplar for a question
 * the student has not attempted. After an attempt, guidance lives on the attempt's hint ladder.
 */
export const GET = route((ctx, p) => {
  const u = ctx.requireUser();
  const q = getPracticableQuestion(ctx.db, p.id);
  assertAttemptedBefore(ctx.db, u.id, q.id);
  const a = ctx.db
    .prepare("SELECT id FROM attempts WHERE user_id = ? AND question_id = ? AND status = 'evaluated' ORDER BY created_at DESC LIMIT 1")
    .get(u.id, q.id) as { id: string } | undefined;
  if (!a) throw new AppError("EVALUATION_REQUIRED", "Get feedback on your attempt first; guidance unlocks step by step on the hint ladder.");
  return { hint_ladder: `/attempt/${a.id}#ladder` };
});
