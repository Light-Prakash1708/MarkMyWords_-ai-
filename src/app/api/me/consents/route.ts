import { z } from "zod";
import { route } from "@/lib/http";
import { getConsents, setConsent } from "@/lib/services/users";

export const GET = route(async (ctx) => ({ consents: (await getConsents(ctx.db, ctx.requireUser().id)) }));
export const POST = route(async (ctx) => {
  const u = ctx.requireUser();
  const p = z.object({ purpose: z.string(), granted: z.boolean() }).parse(await ctx.json());
  (await setConsent(ctx.db, u.id, p.purpose, p.granted));
  return { consents: (await getConsents(ctx.db, u.id)) };
});
