import { createHmac, timingSafeEqual } from "node:crypto";
import { getEnv } from "../env";

/** Short-lived signed URLs for private uploads (TTL ≤ 5 minutes). Ownership is ALSO checked server-side. */
export const SIGNED_URL_TTL_SEC = 300;

function sig(resource: string, exp: number): string {
  return createHmac("sha256", getEnv().signingSecret).update(`${resource}:${exp}`).digest("base64url");
}

export function signResource(resource: string, ttlSec = SIGNED_URL_TTL_SEC, now = Date.now()): { exp: number; sig: string } {
  const exp = Math.floor(now / 1000) + Math.min(ttlSec, SIGNED_URL_TTL_SEC);
  return { exp, sig: sig(resource, exp) };
}

export function verifyResource(resource: string, exp: number, signature: string, now = Date.now()): boolean {
  if (!Number.isFinite(exp) || exp < Math.floor(now / 1000)) return false;
  const expected = Buffer.from(sig(resource, exp));
  const given = Buffer.from(signature || "");
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export function signedUploadUrl(uploadId: string): string {
  const { exp, sig: s } = signResource(`upload:${uploadId}`);
  return `/api/uploads/${uploadId}?exp=${exp}&sig=${s}`;
}
