import { NextResponse } from "next/server";
import { SESSION_COOKIE, destroySession } from "@/lib/auth/session";
import { clearSessionCookie, route } from "@/lib/http";

export const POST = route(async (ctx) => {
  destroySession(ctx.db, ctx.req.cookies.get(SESSION_COOKIE)?.value);
  return clearSessionCookie(NextResponse.json({ ok: true }));
});
