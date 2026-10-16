import { route } from "@/lib/http";
import { removeUpload } from "@/lib/services/attempts";

export const DELETE = route(async (ctx, p) => {
  (await removeUpload(ctx.db, ctx.requireUser().id, p.id, p.uploadId));
  return { ok: true };
});
