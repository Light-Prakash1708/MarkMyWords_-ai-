import { route } from "@/lib/http";
import { removeUpload } from "@/lib/services/attempts";

export const DELETE = route((ctx, p) => {
  removeUpload(ctx.db, ctx.requireUser().id, p.id, p.uploadId);
  return { ok: true };
});
