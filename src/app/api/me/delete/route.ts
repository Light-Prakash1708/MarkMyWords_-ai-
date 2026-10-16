import { NextResponse } from "next/server";
import { z } from "zod";
import { clearSessionCookie, route } from "@/lib/http";
import { deleteAccount } from "@/lib/services/users";

export const POST = route(async (ctx) => {
  const u = ctx.requireUser();
  const p = z.object({ confirm_email: z.string() }).parse(await ctx.json());
  (await deleteAccount(ctx.db, u.id, p.confirm_email));
  return clearSessionCookie(NextResponse.json({ ok: true }));
});
