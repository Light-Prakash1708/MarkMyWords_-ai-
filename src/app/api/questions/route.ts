import { route } from "@/lib/http";
import { listQuestions } from "@/lib/services/questions";

export const GET = route((ctx) => {
  const u = ctx.requireUser();
  const paper = ctx.req.nextUrl.searchParams.get("paper") ?? undefined;
  return { questions: listQuestions(ctx.db, { examCode: u.target_exam_code, paperCode: paper }) };
});
