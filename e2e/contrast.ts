/** In-page script: lists visible text whose WCAG contrast against its effective background is below AA. */
export const CONTRAST_JS = `(() => {
  const parse = (c) => { const m = c.match(/rgba?\\(([^)]+)\\)/); if (!m) return null; const p = m[1].split(/[ ,\\/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const blend = (top, bot) => ({ r: top.r * top.a + bot.r * (1 - top.a), g: top.g * top.a + bot.g * (1 - top.a), b: top.b * top.a + bot.b * (1 - top.a), a: 1 });
  const bgOf = (el) => { const stack = []; for (let e = el; e; e = e.parentElement) { const cs = getComputedStyle(e); const c = parse(cs.backgroundColor); if (cs.backgroundImage && cs.backgroundImage !== "none" && !cs.backgroundImage.includes("gradient")) return null; if (c && c.a > 0) { stack.push(c); if (c.a >= 1) break; } } let acc = { r: 255, g: 255, b: 255, a: 1 }; for (let i = stack.length - 1; i >= 0; i--) acc = blend(stack[i], acc); return acc; };
  const bad = [];
  const seen = new Set();
  for (const el of document.querySelectorAll("body *")) {
    if (!(el instanceof HTMLElement)) continue;
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1);
    const isField = el.matches("input,textarea,select");
    if (!own && !isField) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) === 0) continue;
    const rect = el.getBoundingClientRect(); if (rect.width === 0 || rect.height === 0) continue;
    if (el.closest("[aria-hidden=true]") && !el.closest(".ribbon")) continue;
    const fg = parse(cs.color); const bg = bgOf(el); if (!fg || !bg) continue;
    const f = blend(fg, bg);
    const L1 = lum(f), L2 = lum(bg); const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    const size = parseFloat(cs.fontSize); const bold = Number(cs.fontWeight) >= 700;
    const need = size >= 24 || (size >= 18.66 && bold) ? 3 : 4.5;
    if (ratio < need) {
      const text = (isField ? (el.placeholder || el.value || el.tagName) : el.textContent).trim().replace(/\\s+/g, " ").slice(0, 50);
      const key = el.className + "|" + text; if (seen.has(key)) continue; seen.add(key);
      bad.push({ ratio: Math.round(ratio * 100) / 100, need, tag: el.tagName.toLowerCase(), cls: String(el.className).slice(0, 40), text });
    }
  }
  return bad;
})()`;

export type LowContrast = { ratio: number; need: number; tag: string; cls: string; text: string };
