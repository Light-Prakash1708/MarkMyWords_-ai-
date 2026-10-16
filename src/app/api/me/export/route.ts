import { NextResponse } from "next/server";
import { route } from "@/lib/http";
import { exportUserData } from "@/lib/services/users";

export const GET = route(async (ctx) => {
  const u = ctx.requireUser();
  const data = (await exportUserData(ctx.db, u.id));
  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: { "content-type": "application/json", "content-disposition": `attachment; filename="markmywords-export-${new Date().toISOString().slice(0, 10)}.json"`, "cache-control": "no-store" },
  });
});
