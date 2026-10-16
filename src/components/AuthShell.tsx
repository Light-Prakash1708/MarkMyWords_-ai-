import { Star } from "./Landing";

export function AuthShell({ title, kicker, children }: { title: React.ReactNode; kicker: string; children: React.ReactNode }) {
  return (
    <div className="grid-paper" style={{ ["--bgc" as string]: "var(--sky)", minHeight: "calc(100vh - 60px)", position: "relative", overflow: "hidden" }}>
      <Star size={54} color="var(--pink)" style={{ left: "8%", top: "12%" }} />
      <Star size={34} color="var(--butter)" style={{ right: "10%", top: "20%", animationDelay: "-3s" }} />
      <div className="container" style={{ padding: "48px 16px 70px", display: "grid", placeItems: "center" }}>
        <div style={{ width: "100%", maxWidth: 460 }}>
          <div style={{ textAlign: "center", marginBottom: 22 }}>
            <span className="ink-label">{kicker}</span>
            <h1 className="h1" style={{ marginTop: 14, color: "var(--on-pastel)" }}>{title}</h1>
          </div>
          <div className="card" style={{ padding: 26 }}>{children}</div>
        </div>
      </div>
    </div>
  );
}
