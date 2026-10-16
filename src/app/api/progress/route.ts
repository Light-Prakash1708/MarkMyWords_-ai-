import { route } from "@/lib/http";
import { getProgress, weeklyReport } from "@/lib/services/skills";

export const GET = route(async (ctx) => {
  const u = ctx.requireUser();
  return { progress: (await getProgress(ctx.db, u.id)), weekly: (await weeklyReport(ctx.db, u.id)) };
});
