import { route } from "@/lib/http";
import { getProgress, weeklyReport } from "@/lib/services/skills";

export const GET = route((ctx) => {
  const u = ctx.requireUser();
  return { progress: getProgress(ctx.db, u.id), weekly: weeklyReport(ctx.db, u.id) };
});
