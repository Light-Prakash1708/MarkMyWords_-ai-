import { route } from "@/lib/http";
import { addUpload } from "@/lib/services/attempts";
import { AppError } from "@/lib/util/errors";
import { getEnv } from "@/lib/env";
import { signedUploadUrl } from "@/lib/security/signing";

export const POST = route(async (ctx, p) => {
  const u = ctx.requireUser();
  const len = Number(ctx.req.headers.get("content-length") ?? 0);
  const env = getEnv();
  if (len > env.maxPdfBytes + 1024 * 1024) throw new AppError("UPLOAD_REJECTED", "File is too large.");
  const form = await ctx.req.formData().catch(() => null);
  const file = form?.get("file");
  if (!file || typeof file === "string") throw new AppError("VALIDATION", "Attach a file in the 'file' field.");
  const buf = Buffer.from(await file.arrayBuffer());
  const up = await addUpload(ctx.db, u.id, p.id, buf);
  return { upload: { ...up, url: signedUploadUrl(up.id) } };
});
