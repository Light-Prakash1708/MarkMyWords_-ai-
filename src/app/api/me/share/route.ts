import { route } from "@/lib/http";
import { rateLimit } from "@/lib/security/rate-limit";
import { createShareLink } from "@/lib/services/skills";

export const POST = route(async (ctx) => {
  const u = ctx.requireUser();
  (await rateLimit(ctx.db, `share:${u.id}`, 10, 86400));
  return { path: `/share/${(await createShareLink(ctx.db, u.id))}` };
});
