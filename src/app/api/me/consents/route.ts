import { z } from "zod";
import { route } from "@/lib/http";
import { getConsents, setConsent } from "@/lib/services/users";

export const GET = route((ctx) => ({ consents: getConsents(ctx.db, ctx.requireUser().id) }));
export const POST = route(async (ctx) => {
  const u = ctx.requireUser();
  const p = z.object({ purpose: z.string(), granted: z.boolean() }).parse(await ctx.json());
  setConsent(ctx.db, u.id, p.purpose, p.granted);
  return { consents: getConsents(ctx.db, u.id) };
});
