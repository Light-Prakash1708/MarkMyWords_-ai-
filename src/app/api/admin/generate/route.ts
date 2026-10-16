import { route } from "@/lib/http";
import { generateQuestionsFromSource, requireAdmin } from "@/lib/services/admin";

export const POST = route(async (ctx) => ({ created: await generateQuestionsFromSource(ctx.db, requireAdmin(ctx.user), await ctx.json()) }));
