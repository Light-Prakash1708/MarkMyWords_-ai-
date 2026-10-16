import net from "node:net";
import { getEnv } from "../env";

export type ScanStatus = "clean" | "infected" | "not_scanned" | "scan_error";

/**
 * Malware-scan hook. If MMW_CLAMAV_HOST is set, streams the file to clamd using the INSTREAM
 * protocol. Otherwise records `not_scanned` (images are still re-encoded, which removes most
 * embedded payloads; PDFs are structurally screened in uploads.ts).
 */
export async function scanBuffer(buf: Buffer): Promise<{ status: ScanStatus; detail?: string }> {
  const env = getEnv();
  if (!env.clamavHost) return { status: "not_scanned" };
  return new Promise((resolve) => {
    const sock = net.createConnection({ host: env.clamavHost, port: env.clamavPort });
    let reply = "";
    const done = (r: { status: ScanStatus; detail?: string }) => {
      sock.destroy();
      resolve(r);
    };
    sock.setTimeout(15000, () => done({ status: "scan_error", detail: "timeout" }));
    sock.on("error", (e) => done({ status: "scan_error", detail: e.message }));
    sock.on("data", (d) => (reply += d.toString()));
    sock.on("end", () => {
      if (/OK\s*$/.test(reply.replace(/\0/g, ""))) done({ status: "clean" });
      else if (/FOUND/.test(reply)) done({ status: "infected", detail: reply.trim() });
      else done({ status: "scan_error", detail: reply.trim() });
    });
    sock.on("connect", () => {
      sock.write("zINSTREAM\0");
      const CHUNK = 64 * 1024;
      for (let i = 0; i < buf.length; i += CHUNK) {
        const part = buf.subarray(i, i + CHUNK);
        const len = Buffer.alloc(4);
        len.writeUInt32BE(part.length, 0);
        sock.write(len);
        sock.write(part);
      }
      sock.write(Buffer.alloc(4));
    });
  });
}
