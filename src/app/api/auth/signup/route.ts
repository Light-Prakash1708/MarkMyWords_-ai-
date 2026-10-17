import { NextResponse } from "next/server";
import { clientIp, route, withSessionCookie } from "@/lib/http";
import { isGuest } from "@/lib/services/trial";
import { signup } from "@/lib/services/users";

export const POST = route(async (ctx) => {
  // Signing up from a guest trial converts the guest into this account, keeping their answers.
  const guestId = isGuest(ctx.user) ? ctx.user!.id : null;
  const { user, token, expiresAt } = await signup(ctx.db, await ctx.json(), clientIp(ctx.req), guestId);
  return withSessionCookie(NextResponse.json({ user: { id: user.id, display_name: user.display_name } }), token, expiresAt);
});
