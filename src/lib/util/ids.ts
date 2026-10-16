import { createHash, randomBytes, randomUUID } from "node:crypto";

export const newId = (): string => randomUUID();
export const nowIso = (d: Date = new Date()): string => d.toISOString();
export const sha256Hex = (data: string | Buffer): string => createHash("sha256").update(data).digest("hex");
export const randomToken = (bytes = 32): string => randomBytes(bytes).toString("base64url");
export const traceId = (): string => `tr_${randomBytes(8).toString("hex")}`;

/** Local calendar date (YYYY-MM-DD) in Asia/Kolkata, the primary audience's timezone. */
export function istDate(d: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
  return parts;
}

/** Start of the current IST day as an ISO timestamp (for daily quotas). */
export function istDayStartIso(d: Date = new Date()): string {
  const date = istDate(d);
  return new Date(`${date}T00:00:00+05:30`).toISOString();
}
