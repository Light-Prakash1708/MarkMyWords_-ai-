import { NextResponse } from "next/server";
import { clientIp, route, withSessionCookie } from "@/lib/http";
import { login } from "@/lib/services/users";

export const POST = route(async (ctx) => {
  const { token, expiresAt } = await login(ctx.db, await ctx.json(), clientIp(ctx.req));
  return withSessionCookie(NextResponse.json({ ok: true }), token, expiresAt);
});
