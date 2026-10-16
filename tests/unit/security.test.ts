import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { hashPassword, passwordProblem, verifyPassword } from "@/lib/auth/password";
import { createSession, destroySession, userForToken } from "@/lib/auth/session";
import { rateLimit } from "@/lib/security/rate-limit";
import { signResource, verifyResource } from "@/lib/security/signing";
import { detectType, screenPdf, validateUpload } from "@/lib/security/uploads";
import { freshDb, makeUser } from "../helpers";

async function page(w = 1000, h = 1300) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#f4f1e8"/><text x="60" y="140" font-size="40" fill="#111">Handwritten answer text line one</text><text x="60" y="200" font-size="40" fill="#111">and line two of the answer</text></svg>`;
  return sharp(Buffer.from(svg)).jpeg().withMetadata({ exif: { IFD0: { Copyright: "secret-gps-like-metadata" } } }).toBuffer();
}
const pdf = (body: string) => Buffer.from(`%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n3 0 obj << /Type /Page /Parent 2 0 R >> endobj\n${body}\ntrailer << /Root 1 0 R >>\n%%EOF\n`, "latin1");

describe("passwords and sessions", async () => {
  it("hashes and verifies with scrypt", async () => {
    const h = await hashPassword("a long test password");
    expect(h.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("a long test password", h)).toBe(true);
    expect(await verifyPassword("wrong password!!", h)).toBe(false);
  });
  it("enforces a minimum length", () => {
    expect(passwordProblem("short")).not.toBeNull();
    expect(passwordProblem("a perfectly fine phrase")).toBeNull();
  });
  const { db } = freshDb();
  it("stores only token hashes and can destroy sessions", async () => {
    const u = await makeUser(db);
    const { token } = createSession(db, u.id);
    expect(db.prepare("SELECT 1 FROM sessions WHERE token_hash = ?").get(token)).toBeUndefined();
    expect(userForToken(db, token)?.id).toBe(u.id);
    destroySession(db, token);
    expect(userForToken(db, token)).toBeNull();
  });
  it("rate limits within a window", () => {
    for (let i = 0; i < 3; i++) rateLimit(db, "t:key", 3, 60, 1_000_000);
    expect(() => rateLimit(db, "t:key", 3, 60, 1_000_000)).toThrow(/Too many/);
    expect(() => rateLimit(db, "t:key", 3, 60, 1_000_000 + 61_000)).not.toThrow();
  });
});

describe("signed URLs", () => {
  it("verify within TTL and reject tampering/expiry", () => {
    const now = Date.now();
    const { exp, sig } = signResource("upload:1", 300, now);
    expect(verifyResource("upload:1", exp, sig, now)).toBe(true);
    expect(verifyResource("upload:2", exp, sig, now)).toBe(false);
    expect(verifyResource("upload:1", exp, sig, now + 301_000)).toBe(false);
    expect(signResource("x", 99999, now).exp - Math.floor(now / 1000)).toBeLessThanOrEqual(300);
  });
});

describe("upload validation", () => {
  it("detects types by magic bytes, not names", async () => {
    expect(detectType(await page())).toBe("image/jpeg");
    expect(detectType(Buffer.from("MZ\x90\x00executable"))).toBe("unknown");
    expect(detectType(pdf(""))).toBe("application/pdf");
  });
  it("rejects a renamed executable", async () => {
    await expect(validateUpload(Buffer.from("MZ\x90\x00 this is an exe renamed .jpg"), 0)).rejects.toThrow(/Unsupported/);
  });
  it("re-encodes images and strips metadata", async () => {
    const src = await page();
    expect(src.toString("latin1")).toContain("secret-gps-like-metadata");
    const v = await validateUpload(src, 0);
    expect(v.kind).toBe("image");
    expect(v.buffer.toString("latin1")).not.toContain("secret-gps-like-metadata");
    expect((await sharp(v.buffer).metadata()).exif).toBeUndefined();
  });
  it("neutralises polyglots by re-encoding (appended payload removed)", async () => {
    const poly = Buffer.concat([await page(), Buffer.from("PK\x03\x04 appended zip payload <script>")]);
    const v = await validateUpload(poly, 0);
    expect(v.buffer.toString("latin1")).not.toContain("appended zip payload");
  });
  it("asks for a retake on tiny or very dark images", async () => {
    await expect(validateUpload(await page(200, 200), 0)).rejects.toThrow(/retake/i);
    const dark = await sharp({ create: { width: 900, height: 1200, channels: 3, background: "#050505" } }).jpeg().toBuffer();
    await expect(validateUpload(dark, 0)).rejects.toThrow(/dark/i);
  });
  it("rejects HEIC with guidance", async () => {
    const heic = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypheic"), Buffer.alloc(32)]);
    await expect(validateUpload(heic, 0)).rejects.toThrow(/HEIC/);
  });
  it("screens PDFs for active content, encryption and truncation", () => {
    expect(screenPdf(pdf("")).pageCount).toBe(1);
    expect(() => screenPdf(pdf("4 0 obj << /S /JavaScript /JS (app.alert(1)) >> endobj"))).toThrow(/JavaScript/);
    expect(() => screenPdf(pdf("<< /Encrypt 5 0 R >>"))).toThrow(/Encrypted/);
    expect(() => screenPdf(pdf("<< /EmbeddedFile 6 0 R >>"))).toThrow(/embedded/);
    expect(() => screenPdf(Buffer.from("%PDF-1.4\n/Type /Page\n"))).toThrow(/truncated/);
  });
  it("enforces the page limit", async () => {
    await expect(validateUpload(await page(), 12)).rejects.toThrow(/at most/);
  });
});
