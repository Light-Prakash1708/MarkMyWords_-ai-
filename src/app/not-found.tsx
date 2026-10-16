import Link from "next/link";

export default function NotFound() {
  return (
    <div className="page container" style={{ textAlign: "center", maxWidth: 640 }}>
      <div className="signboard"><h1 className="display" style={{ fontSize: "clamp(2.4rem, 8vw, 4.5rem)" }}>404</h1><div className="sub">This page went off-topic</div></div>
      <p style={{ marginTop: 22 }}><Link className="btn" href="/">Back to the start</Link></p>
    </div>
  );
}
