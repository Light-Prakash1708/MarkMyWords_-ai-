import { route } from "@/lib/http";
import { submitManualTranscript } from "@/lib/services/attempts";

/** Manual transcription (used when no OCR provider is configured, or OCR failed). */
export const POST = route(async (ctx, p) => ({ attempt: submitManualTranscript(ctx.db, ctx.requireUser().id, p.id, await ctx.json()) }));
