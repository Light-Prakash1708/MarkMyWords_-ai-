import { NextResponse } from "next/server";
import { route } from "@/lib/http";
import { verifyResource } from "@/lib/security/signing";
import { readUpload } from "@/lib/services/attempts";
import { AppError } from "@/lib/util/errors";

/** Private uploads: valid short-lived signature AND an owner (or audited reviewer) session. */
export const GET = route((ctx, p) => {
  const u = ctx.requireUser();
  const exp = Number(ctx.req.nextUrl.searchParams.get("exp"));
  const sig = ctx.req.nextUrl.searchParams.get("sig") ?? "";
  if (!verifyResource(`upload:${p.id}`, exp, sig)) throw new AppError("FORBIDDEN", "This link has expired. Reload the page.");
  const { buf, mime } = readUpload(ctx.db, u, p.id);
  return new NextResponse(new Uint8Array(buf), {
    headers: { "content-type": mime, "cache-control": "private, no-store", "content-disposition": "inline", "x-content-type-options": "nosniff" },
  });
});
