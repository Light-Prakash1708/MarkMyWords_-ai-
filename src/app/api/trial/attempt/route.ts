import { NextResponse } from "next/server";
import { z } from "zod";
import { clientIp, route, withSessionCookie } from "@/lib/http";
import { createAttempt } from "@/lib/services/attempts";
import { getPracticableQuestion } from "@/lib/services/questions";
import { startGuest } from "@/lib/services/trial";

/**
 * Start (or reopen) a trial answer. Visitors without an account get a private guest session here;
 * signed-in users simply start a normal attempt.
 */
export const POST = route(async (ctx) => {
  const body = z.object({ question_id: z.string().min(1).max(120), mode: z.enum(["typed", "handwritten"]).optional() }).parse(await ctx.json());
  const q = await getPracticableQuestion(ctx.db, body.question_id);
  let user = ctx.user;
  let session: { token: string; expiresAt: Date } | null = null;
  if (!user) {
    const g = await startGuest(ctx.db, clientIp(ctx.req), q.exam_code);
    user = g.user;
    session = { token: g.token, expiresAt: g.expiresAt };
  }
  // Reopen an unfinished trial attempt instead of starting a second one.
  const open = (await ctx.db.get(
    "SELECT id FROM attempts WHERE user_id = ? AND question_id = ? AND attempt_kind = 'first' ORDER BY created_at DESC LIMIT 1",
    user.id,
    q.id,
  )) as { id: string } | undefined;
  const mode = body.mode && q.input_modes.includes(body.mode) ? body.mode : "typed";
  const attemptId = open?.id ?? (await createAttempt(ctx.db, user.id, { question_id: q.id, mode: q.input_modes.includes(mode) ? mode : q.input_modes[0] })).id;
  const res = NextResponse.json({ attempt_id: attemptId });
  return session ? withSessionCookie(res, session.token, session.expiresAt) : res;
});
