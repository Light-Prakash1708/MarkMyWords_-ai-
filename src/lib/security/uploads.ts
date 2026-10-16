import sharp from "sharp";
import { getEnv } from "../env";
import { AppError } from "../util/errors";

export type DetectedType = "image/jpeg" | "image/png" | "image/webp" | "application/pdf" | "image/heic" | "unknown";

/** Identify a file by magic bytes — never trust the extension or the Content-Type header. */
export function detectType(buf: Buffer): DetectedType {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.length >= 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (buf.length >= 5 && buf.toString("ascii", 0, 5) === "%PDF-") return "application/pdf";
  if (buf.length >= 12 && buf.toString("ascii", 4, 8) === "ftyp") {
    const brand = buf.toString("ascii", 8, 12);
    if (["heic", "heix", "hevc", "mif1", "msf1"].includes(brand)) return "image/heic";
  }
  return "unknown";
}

export interface ImageQuality {
  width: number;
  height: number;
  brightness: number; // 0-255 mean luminance
  sharpness: number; // sharp's Laplacian-based estimate
  verdict: "ok" | "warn" | "retake";
  problems: string[];
}

export interface ValidatedImage {
  kind: "image";
  buffer: Buffer; // re-encoded JPEG, metadata stripped
  storedMime: "image/jpeg";
  originalMime: DetectedType;
  quality: ImageQuality;
  pageCount: 1;
}

export interface ValidatedPdf {
  kind: "pdf";
  buffer: Buffer;
  storedMime: "application/pdf";
  originalMime: "application/pdf";
  pageCount: number;
}

/** Thresholds are heuristic starting points; they only block extreme cases. */
const MIN_SHORT_SIDE = 500;
const DARK = 50;
const BRIGHT_WASHOUT = 248;
const BLURRY = 0.6;

export async function assessImage(buf: Buffer): Promise<ImageQuality> {
  const img = sharp(buf, { failOn: "error", limitInputPixels: 60_000_000 }).rotate();
  const meta = await img.metadata();
  const stats = await img.clone().greyscale().stats();
  const width = meta.autoOrient?.width ?? meta.width ?? 0;
  const height = meta.autoOrient?.height ?? meta.height ?? 0;
  const brightness = stats.channels[0]?.mean ?? 0;
  const sharpness = stats.sharpness ?? 0;
  const problems: string[] = [];
  let verdict: ImageQuality["verdict"] = "ok";
  if (Math.min(width, height) < MIN_SHORT_SIDE) {
    problems.push(`Image is small (${width}×${height}). Use at least ${MIN_SHORT_SIDE}px on the short side.`);
    verdict = "retake";
  }
  if (brightness < DARK) {
    problems.push("Photo is very dark. Retake in better light.");
    verdict = "retake";
  } else if (brightness > BRIGHT_WASHOUT) {
    problems.push("Photo looks washed out. Avoid direct glare.");
    verdict = verdict === "retake" ? verdict : "warn";
  }
  if (sharpness < BLURRY) {
    problems.push("Photo may be blurry. Hold the phone steady and focus on the text.");
    verdict = verdict === "retake" ? verdict : "warn";
  }
  return { width, height, brightness: Math.round(brightness), sharpness: Number(sharpness.toFixed(3)), verdict, problems };
}

/** Structural screening for PDFs: reject active content, attachments and encryption. */
export function screenPdf(buf: Buffer): { pageCount: number } {
  const text = buf.toString("latin1");
  const forbidden: [RegExp, string][] = [
    [/\/Encrypt\b/, "Encrypted PDFs are not accepted."],
    [/\/JavaScript\b|\/JS\b/, "PDFs containing JavaScript are not accepted."],
    [/\/EmbeddedFile\b/, "PDFs with embedded files are not accepted."],
    [/\/Launch\b/, "PDFs with launch actions are not accepted."],
    [/\/RichMedia\b/, "PDFs with rich media are not accepted."],
    [/\/XFA\b/, "XFA forms are not accepted."],
  ];
  for (const [re, msg] of forbidden) if (re.test(text)) throw new AppError("UPLOAD_REJECTED", msg);
  if (!/%%EOF\s*$/.test(text.slice(-1024))) throw new AppError("UPLOAD_REJECTED", "The PDF appears to be truncated or malformed.");
  const pageCount = (text.match(/\/Type\s*\/Page(?![s\w])/g) || []).length;
  if (pageCount === 0) throw new AppError("UPLOAD_REJECTED", "Could not find any pages in this PDF.");
  return { pageCount };
}

export async function validateUpload(buf: Buffer, existingPages: number): Promise<ValidatedImage | ValidatedPdf> {
  const env = getEnv();
  const type = detectType(buf);
  if (type === "unknown") throw new AppError("UPLOAD_REJECTED", "Unsupported file. Upload JPEG, PNG, WebP or PDF.");
  if (type === "image/heic") {
    throw new AppError("UPLOAD_REJECTED", "HEIC photos are not supported yet. Set your camera to 'Most compatible' (JPEG) or export as JPEG.");
  }
  if (type === "application/pdf") {
    if (buf.length > env.maxPdfBytes) throw new AppError("UPLOAD_REJECTED", `PDF is larger than ${Math.round(env.maxPdfBytes / 1048576)} MB.`);
    const { pageCount } = screenPdf(buf);
    if (existingPages + pageCount > env.maxPagesPerAttempt) {
      throw new AppError("UPLOAD_REJECTED", `An attempt can have at most ${env.maxPagesPerAttempt} pages.`);
    }
    return { kind: "pdf", buffer: buf, storedMime: "application/pdf", originalMime: "application/pdf", pageCount };
  }
  if (buf.length > env.maxImageBytes) throw new AppError("UPLOAD_REJECTED", `Image is larger than ${Math.round(env.maxImageBytes / 1048576)} MB.`);
  if (existingPages + 1 > env.maxPagesPerAttempt) throw new AppError("UPLOAD_REJECTED", `An attempt can have at most ${env.maxPagesPerAttempt} pages.`);
  let quality: ImageQuality;
  let reencoded: Buffer;
  try {
    quality = await assessImage(buf);
    // Re-encode: applies EXIF orientation, then strips ALL metadata (incl. GPS) and anything appended.
    reencoded = await sharp(buf, { failOn: "error", limitInputPixels: 60_000_000 })
      .rotate()
      .resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 85, mozjpeg: true })
      .toBuffer();
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError("UPLOAD_REJECTED", "The image could not be decoded. It may be corrupted.");
  }
  if (quality.verdict === "retake") {
    throw new AppError("UPLOAD_REJECTED", `Please retake this page: ${quality.problems.join(" ")}`, { details: quality });
  }
  return { kind: "image", buffer: reencoded, storedMime: "image/jpeg", originalMime: type, quality, pageCount: 1 };
}
