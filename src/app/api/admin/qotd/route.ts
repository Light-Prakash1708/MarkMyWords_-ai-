import { z } from "zod";
import { route } from "@/lib/http";
import { requireStaff } from "@/lib/services/admin";
import { scheduleQotd } from "@/lib/services/questions";

export const POST = route(async (ctx) => {
  const u = requireStaff(ctx.user);
  const p = z.object({ exam_code: z.string(), date: z.string(), question_id: z.string() }).parse(await ctx.json());
  scheduleQotd(ctx.db, u.id, p.exam_code, p.date, p.question_id);
  return { ok: true };
});
