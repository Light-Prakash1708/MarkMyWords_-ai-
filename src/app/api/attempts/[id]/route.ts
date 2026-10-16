import { z } from "zod";
import { route } from "@/lib/http";
import { getOwnedAttempt, latestOcr, latestTranscript, listUploads, saveDraft } from "@/lib/services/attempts";
import { latestEvaluation } from "@/lib/services/evaluations";
import { signedUploadUrl } from "@/lib/security/signing";

export const GET = route((ctx, p) => {
  const u = ctx.requireUser();
  const a = getOwnedAttempt(ctx.db, u.id, p.id);
  const ocr = latestOcr(ctx.db, a.id);
  return {
    attempt: a,
    transcript: latestTranscript(ctx.db, a.id),
    ocr: ocr ? { status: ocr.status, error: ocr.error, built: ocr.built } : null,
    uploads: listUploads(ctx.db, u.id, a.id).map((x) => ({ ...x, url: signedUploadUrl(x.id) })),
    evaluation: latestEvaluation(ctx.db, a.id),
  };
});

export const PATCH = route(async (ctx, p) => {
  const body = z.object({ draft_text: z.string() }).parse(await ctx.json());
  saveDraft(ctx.db, ctx.requireUser().id, p.id, body.draft_text);
  return { ok: true, saved_at: new Date().toISOString() };
});
