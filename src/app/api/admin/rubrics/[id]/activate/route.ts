import { route } from "@/lib/http";
import { activateRubricVersion, requireAdmin } from "@/lib/services/admin";

export const POST = route((ctx, p) => {
  activateRubricVersion(ctx.db, requireAdmin(ctx.user), p.id);
  return { ok: true };
});
