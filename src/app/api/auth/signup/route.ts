import { NextResponse } from "next/server";
import { clientIp, route, withSessionCookie } from "@/lib/http";
import { signup } from "@/lib/services/users";

export const POST = route(async (ctx) => {
  const { user, token, expiresAt } = await signup(ctx.db, await ctx.json(), clientIp(ctx.req));
  return withSessionCookie(NextResponse.json({ user: { id: user.id, display_name: user.display_name } }), token, expiresAt);
});
