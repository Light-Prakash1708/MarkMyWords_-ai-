import { route } from "@/lib/http";
import { recommendNext } from "@/lib/services/skills";

export const GET = route((ctx) => ({ recommendations: recommendNext(ctx.db, ctx.requireUser().id) }));
