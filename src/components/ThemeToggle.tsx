"use client";
import { useEffect, useState } from "react";

type Mode = "system" | "light" | "dark";

export function ThemeToggle() {
  const [mode, setMode] = useState<Mode>("system");
  useEffect(() => {
    try {
      const t = localStorage.getItem("mmw-theme");
      if (t === "light" || t === "dark") setMode(t);
    } catch {}
  }, []);
  const next = () => {
    const order: Mode[] = ["system", "light", "dark"];
    const m = order[(order.indexOf(mode) + 1) % 3];
    setMode(m);
    try {
      if (m === "system") localStorage.removeItem("mmw-theme");
      else localStorage.setItem("mmw-theme", m);
    } catch {}
    if (m === "system") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", m);
  };
  const icon =
    mode === "dark" ? (
      <path d="M15 3a7 7 0 1 0 6 10A8 8 0 0 1 15 3z" fill="currentColor" />
    ) : mode === "light" ? (
      <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="4.5" fill="currentColor" /><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8" /></g>
    ) : (
      <g><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor" /></g>
    );
  return (
    <button type="button" onClick={next} className="btn ghost sm icon-btn" style={{ color: "var(--inv-fg)", borderColor: "rgba(251,245,234,.35)", minWidth: 40 }} aria-label={`Theme: ${mode}. Click to change.`} title={`Theme: ${mode}`}>
      <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">{icon}</svg>
    </button>
  );
}
