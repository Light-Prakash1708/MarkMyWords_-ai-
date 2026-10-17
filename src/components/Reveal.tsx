"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";

/** Adds `.in` to every `.reveal` element as it scrolls into view (respects reduced motion via CSS). */
export function RevealRoot() {
  const path = usePathname();
  useEffect(() => {
    const els = () => Array.from(document.querySelectorAll<HTMLElement>(".reveal:not(.in)"));
    if (!("IntersectionObserver" in window)) {
      els().forEach((e) => e.classList.add("in"));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); } }),
      { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
    );
    els().forEach((e) => io.observe(e));
    const mo = new MutationObserver(() => els().forEach((e) => io.observe(e)));
    mo.observe(document.body, { childList: true, subtree: true });
    // Safety net: anything on screen that the observer missed (odd layouts, slow hydration) appears.
    const t = window.setInterval(() => els().forEach((e) => { if (e.getBoundingClientRect().top < window.innerHeight) e.classList.add("in"); }), 1500);
    return () => { io.disconnect(); mo.disconnect(); window.clearInterval(t); };
  }, [path]);
  return null;
}
