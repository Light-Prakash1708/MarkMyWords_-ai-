import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { getDb, type DB } from "./db";
import { getEnv } from "./env";
import { SESSION_COOKIE, userForToken, type SessionUser } from "./auth/session";
import { AppError } from "./util/errors";

/** Server-component helper: the logged-in user, or null. */
export async function currentUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  return userForToken(await getDb(), jar.get(SESSION_COOKIE)?.value);
}

export function clientIp(req: NextRequest): string {
  const xf = req.headers.get("x-forwarded-for");
  if (xf) return xf.split(",")[0].trim().slice(0, 64);
  return req.headers.get("x-real-ip")?.slice(0, 64) ?? "local";
}

/**
 * CSRF defence for state-changing requests: cookies are SameSite=Lax AND we reject requests whose
 * Origin does not match the host, or that the browser labels as cross-site.
 */
export function assertSameOrigin(req: NextRequest) {
  if (req.method === "GET" || req.method === "HEAD") return;
  const site = req.headers.get("sec-fetch-site");
  if (site === "cross-site") throw new AppError("BAD_ORIGIN", "Cross-site request blocked.");
  const origin = req.headers.get("origin");
  if (!origin) return;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try {
    if (new URL(origin).host !== host) throw new AppError("BAD_ORIGIN", "Cross-origin request blocked.");
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError("BAD_ORIGIN", "Invalid origin.");
  }
}

export interface Ctx {
  req: NextRequest;
  db: DB;
  user: SessionUser | null;
  requireUser: () => SessionUser;
  json: () => Promise<unknown>;
}

type Params = { params: Promise<Record<string, string>> };

/** Wrap a route handler: auth lookup, origin check, uniform JSON errors (no internals leaked). */
export function route(fn: (ctx: Ctx, params: Record<string, string>) => Promise<Response | unknown> | Response | unknown) {
  return async (req: NextRequest, p?: Params) => {
    try {
      assertSameOrigin(req);
      const db = (await getDb());
      const user = (await userForToken(db, req.cookies.get(SESSION_COOKIE)?.value));
      const ctx: Ctx = {
        req,
        db,
        user,
        requireUser: () => {
          if (!user) throw new AppError("UNAUTHENTICATED", "Please log in.");
          return user;
        },
        json: async () => {
          const len = Number(req.headers.get("content-length") ?? 0);
          if (len > 200_000) throw new AppError("VALIDATION", "Request too large.");
          try {
            return await req.json();
          } catch {
            throw new AppError("VALIDATION", "Expected a JSON body.");
          }
        },
      };
      const params = p ? await p.params : {};
      const out = await fn(ctx, params);
      if (out instanceof Response) return out;
      return NextResponse.json(out ?? { ok: true });
    } catch (e) {
      return errorResponse(e);
    }
  };
}

export function errorResponse(e: unknown) {
  if (e instanceof AppError) {
    const res = NextResponse.json({ error: { code: e.code, message: e.message, details: e.details ?? null } }, { status: e.status });
    if (e.retryAfterSec) res.headers.set("Retry-After", String(e.retryAfterSec));
    return res;
  }
  if (e && typeof e === "object" && (e as { name?: string }).name === "ZodError") {
    return NextResponse.json({ error: { code: "VALIDATION", message: "Some fields are invalid.", details: (e as { issues?: unknown }).issues ?? null } }, { status: 400 });
  }
  // Never log answer text or request bodies; message only.
  console.error("[mmw] unhandled error:", (e as Error)?.message ?? e);
  return NextResponse.json({ error: { code: "INTERNAL", message: "Something went wrong on our side. Your work is saved." } }, { status: 500 });
}

export function withSessionCookie(res: NextResponse, token: string, expiresAt: Date) {
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: getEnv().secureCookies,
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
  return res;
}

export function clearSessionCookie(res: NextResponse) {
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, secure: getEnv().secureCookies, sameSite: "lax", path: "/", maxAge: 0 });
  return res;
}
