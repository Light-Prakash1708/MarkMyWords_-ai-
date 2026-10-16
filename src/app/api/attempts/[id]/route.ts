import { z } from "zod";
import { route } from "@/lib/http";
import { getOwnedAttempt, latestOcr, latestTranscript, listUploads, saveDraft } from "@/lib/services/attempts";
import { latestEvaluation } from "@/lib/services/evaluations";
import { signedUploadUrl } from "@/lib/security/signing";

export const GET = route(async (ctx, p) => {
  const u = ctx.requireUser();
  const a = (await getOwnedAttempt(ctx.db, u.id, p.id));
  const ocr = (await latestOcr(ctx.db, a.id));
  return {
    attempt: a,
    transcript: (await latestTranscript(ctx.db, a.id)),
    ocr: ocr ? { status: ocr.status, error: ocr.error, built: ocr.built } : null,
    uploads: (await listUploads(ctx.db, u.id, a.id)).map((x) => ({ ...x, url: signedUploadUrl(x.id) })),
    evaluation: (await latestEvaluation(ctx.db, a.id)),
  };
});

export const PATCH = route(async (ctx, p) => {
  const body = z.object({ draft_text: z.string() }).parse(await ctx.json());
  (await saveDraft(ctx.db, ctx.requireUser().id, p.id, body.draft_text));
  return { ok: true, saved_at: new Date().toISOString() };
});
