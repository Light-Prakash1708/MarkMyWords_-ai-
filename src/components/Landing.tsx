"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

export function Ribbon({ items, tilt = false, speed = 32 }: { items: string[]; tilt?: boolean; speed?: number }) {
  const row = [...items, ...items];
  return (
    <div style={{ overflow: "hidden", paddingBlock: tilt ? 10 : 0 }}>
    <div className={`ribbon${tilt ? " tilt" : ""}`} aria-label={items.join(". ")}>
      <div className="ribbon-track" style={{ ["--speed" as string]: `${speed}s` }} aria-hidden="true">
        {row.map((t, i) => (
          <span key={i}>{t}</span>
        ))}
      </div>
    </div>
    </div>
  );
}

export function Bunting({ n = 18 }: { n?: number }) {
  const colors = ["var(--coral)", "var(--butter)", "var(--forest)", "var(--sky)", "var(--pink)", "var(--mint)", "var(--lilac)"];
  return (
    <div className="bunting" aria-hidden="true">
      {Array.from({ length: n }).map((_, i) => (
        <span key={i} className="flag" style={{ ["--c" as string]: colors[i % colors.length], ["--i" as string]: i }} />
      ))}
    </div>
  );
}

export function HangingTags() {
  const tags = [
    { t: "GS-II", s: "UPSC MAINS", c: "var(--pink)", href: "/try", drop: 0 },
    { t: "GS-III", s: "UPSC MAINS", c: "var(--sky)", href: "/try", drop: 22 },
    { t: "RBI GR. B", s: "PREVIEW", c: "var(--butter)", href: "/try", drop: 6 },
    { t: "ESSAY", s: "LATER", c: "var(--mint)", href: "/how-we-evaluate", drop: 30 },
  ];
  return (
    <div className="tags">
      {tags.map((t, i) => (
        <Link key={t.t} href={t.href} className="hang" style={{ ["--i" as string]: i, ["--drop" as string]: `${t.drop}px` }}>
          <span className="string" />
          <span className="tag" style={{ ["--c" as string]: t.c }}>
            <strong>{t.t}</strong>
            <span>{t.s}</span>
          </span>
        </Link>
      ))}
    </div>
  );
}

/** Observes itself and adds `.in` once visible, kicking off the red-pen animation. */
export function RedPenDemo() {
  const ref = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && (setInView(true), io.disconnect()), { threshold: 0.35 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} className={`demo demo-grid${inView ? " in" : ""}`}>
      <div className="sheet" style={{ ["--lh" as string]: "2.1rem" }}>
        <div className="label" style={{ fontFamily: "var(--font-mono)", lineHeight: "2.1rem" }}>Q. Examine the reasons for weak monetary policy transmission in India. (15 marks)</div>
        <p style={{ margin: 0 }}>
          Monetary transmission is how changes in the repo rate reach lending rates.{" "}
          <span className="pen-ul" style={{ ["--t" as string]: 0.4 }}>Transmission is slow and lending rates stay high.</span>{" "}
          <span className="pen-ul green" style={{ ["--t" as string]: 1.2 }}>Banks reprice deposits only as they mature, so their cost of funds falls with a lag.</span>{" "}
          <span className="pen-ul" style={{ ["--t" as string]: 2 }}>GST was rolled out in 2016, which also affected prices.</span>{" "}
          The RBI moved to external benchmarks in 2019.
        </p>
      </div>
      <div className="stack" style={{ ["--gap" as string]: "14px" }}>
        <div className="note post-it pink" style={{ ["--t" as string]: 0.4, ["--r" as string]: "-2deg" }}>
          <div className="label">Analysis · mechanism missing</div>
          “Transmission is slow…” states the outcome, not <em>how</em> it happens. Name the step between the repo rate and the lending rate.
        </div>
        <div className="note post-it mint" style={{ ["--t" as string]: 1.2, ["--r" as string]: "1.5deg" }}>
          <div className="label">Strength</div>
          This is the causal link examiners reward. Keep doing this.
        </div>
        <div className="note post-it" style={{ ["--t" as string]: 2, ["--r" as string]: "-1deg" }}>
          <div className="label">Fact check · cited</div>
          GST was rolled out on 1 July 2017. <span className="chip" style={{ marginTop: 6 }}>Source: GST Council summary · unverified</span>
        </div>
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <div className="stamp" aria-label="Example AI estimate 8 to 9.5 out of 15">
            <div>
              <div className="tiny-l">AI estimate</div>
              <div className="big">8–9.5</div>
              <div className="of">/ 15</div>
              <div className="tiny-l">not official</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const TRUTHS = [
  { t: "You write first. Always.", d: "No model answer, outline or exemplar unlocks until you have submitted your own attempt. The server enforces it — not a polite suggestion." },
  { t: "Every criticism shows its evidence.", d: "Each comment points to the exact words in your answer, the rubric line it fails, and — for facts — a cited source. If we can't point to it, we mark it uncertain." },
  { t: "Scores are estimates, with ranges.", d: "UPSC publishes no criterion-wise rubric. So we show an AI estimate as a range with a confidence level, and tell you why confidence is low when it is." },
  { t: "Improvement means transfer.", d: "Fixing an answer after feedback is repair. Avoiding the same mistake on a fresh question two days later, with no hints, is learning. We track both — separately." },
];

export function Truths() {
  const [i, setI] = useState(0);
  return (
    <div className="truths">
      <div className="truth-list" role="tablist" aria-label="What we hold to be true">
        {TRUTHS.map((x, k) => (
          <button key={k} role="tab" aria-selected={i === k} onClick={() => setI(k)} onMouseEnter={() => setI(k)}>
            <span className="n">0{k + 1}</span> {x.t}
          </button>
        ))}
      </div>
      <div className="truth-detail" role="tabpanel" aria-live="polite">
        <div className="n">0{i + 1}</div>
        <p>{TRUTHS[i].d}</p>
      </div>
    </div>
  );
}

export function Star({ size = 40, color = "var(--pink)", style }: { size?: number; color?: string; style?: React.CSSProperties }) {
  return (
    <svg className="deco float" width={size} height={size} viewBox="0 0 40 40" style={style} aria-hidden="true">
      <path d="M20 2 C22 14 26 18 38 20 C26 22 22 26 20 38 C18 26 14 22 2 20 C14 18 18 14 20 2Z" fill={color} stroke="var(--line)" strokeWidth="2" />
    </svg>
  );
}

export function Squiggle({ style }: { style?: React.CSSProperties }) {
  return (
    <svg className="deco" width="220" height="90" viewBox="0 0 220 90" style={style} aria-hidden="true">
      <path d="M4 70 C40 90 60 20 90 45 S 120 90 140 55 S 190 10 214 16" fill="none" stroke="var(--line)" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M200 8 L214 16 L203 28" fill="none" stroke="var(--line)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
