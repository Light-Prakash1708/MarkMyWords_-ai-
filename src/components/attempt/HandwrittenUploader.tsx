"use client";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { api, ApiError } from "../api";

interface Upload {
  id: string;
  url: string;
  stored_mime: string;
  page_index: number;
  page_count: number;
  quality: { verdict: string; problems: string[] } | null;
}

export function HandwrittenUploader({ attemptId, uploads, startedAt }: { attemptId: string; uploads: Upload[]; startedAt: string }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  async function send(files: FileList | File[]) {
    setErrors([]);
    for (const f of Array.from(files)) {
      setBusy(`Checking ${f.name}…`);
      const form = new FormData();
      form.append("file", f);
      try {
        await api(`/api/attempts/${attemptId}/uploads`, { form });
      } catch (e) {
        setErrors((x) => [...x, `${f.name}: ${e instanceof ApiError ? e.message : "upload failed"}`]);
      }
    }
    setBusy(null);
    router.refresh();
  }
  async function remove(id: string) {
    await api(`/api/attempts/${attemptId}/uploads/${id}`, { method: "DELETE" }).catch(() => undefined);
    router.refresh();
  }
  async function move(i: number, dir: -1 | 1) {
    const order = uploads.map((u) => u.id);
    const j = i + dir;
    if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    await api(`/api/attempts/${attemptId}/uploads/order`, { body: { order } }).catch(() => undefined);
    router.refresh();
  }
  async function submit() {
    setBusy("Submitting…");
    try {
      await api(`/api/attempts/${attemptId}/submit`, { body: { time_spent_sec: Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000)) } });
      router.refresh();
    } catch (e) {
      setErrors([e instanceof ApiError ? e.message : "Could not submit."]);
      setBusy(null);
    }
  }

  return (
    <div className="stack">
      <div className="card pastel bg-sky">
        <h2 className="h3">Write on paper, then photograph each page</h2>
        <p className="small" style={{ marginBottom: 0 }}>Flat sheet, good light, whole page in frame. JPEG, PNG, WebP or PDF. Photos are re-encoded on our server, which strips location data.</p>
      </div>
      <div
        className={`dropzone${over ? " over" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); void send(e.dataTransfer.files); }}
        onClick={() => input.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
        aria-label="Add pages: drop files or choose from your device"
      >
        <div style={{ fontSize: "2rem" }} aria-hidden="true">📸</div>
        <strong>{busy ?? "Tap to take a photo or choose files"}</strong>
        <div className="small muted">or drag pages here</div>
        <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" capture="environment" multiple hidden onChange={(e) => e.target.files && send(e.target.files)} />
      </div>
      {errors.map((e) => <div key={e} className="error-box" role="alert">{e}</div>)}
      {uploads.length > 0 && (
        <div className="thumbs">
          {uploads.map((u, i) => (
            <div className="thumb" key={u.id}>
              {u.stored_mime === "application/pdf" ? (
                <div style={{ height: 170, display: "grid", placeItems: "center", background: "var(--paper-2)" }}>PDF · {u.page_count} page{u.page_count > 1 ? "s" : ""}</div>
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={u.url} alt={`Page ${i + 1}`} />
              )}
              <div className="bar">
                <span className="chip">p{i + 1}</span>
                <span className="row" style={{ gap: 4 }}>
                  <button className="btn sm ghost" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move page ${i + 1} up`}>↑</button>
                  <button className="btn sm ghost" onClick={() => move(i, 1)} disabled={i === uploads.length - 1} aria-label={`Move page ${i + 1} down`}>↓</button>
                  <button className="btn sm ghost" onClick={() => remove(u.id)} aria-label={`Remove page ${i + 1}`}>✕</button>
                </span>
              </div>
              {u.quality?.verdict === "warn" && <div className="tiny" style={{ padding: "0 8px 8px", color: "var(--uncertain)" }}>⚠ {u.quality.problems.join(" ")}</div>}
            </div>
          ))}
        </div>
      )}
      <button className="btn ink lg" disabled={!uploads.length || !!busy} onClick={submit}>Submit {uploads.length} page{uploads.length === 1 ? "" : "s"}</button>
    </div>
  );
}
