import { route } from "@/lib/http";
import { submitManualTranscript } from "@/lib/services/attempts";

/** Manual transcription (used when no OCR provider is configured, or OCR failed). */
export const POST = route(async (ctx, p) => ({ attempt: (await submitManualTranscript(ctx.db, ctx.requireUser().id, p.id, await ctx.json())) }));

// LLM work runs in this request or right after it (after()); allow time on serverless.
export const maxDuration = 300;
