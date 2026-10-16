import { route } from "@/lib/http";
import { activateRubricVersion, requireAdmin } from "@/lib/services/admin";

export const POST = route(async (ctx, p) => {
  (await activateRubricVersion(ctx.db, requireAdmin(ctx.user), p.id));
  return { ok: true };
});
