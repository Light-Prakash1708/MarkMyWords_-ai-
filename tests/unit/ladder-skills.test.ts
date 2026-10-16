import { describe, expect, it } from "vitest";
import { canReveal, reveal, type LadderState } from "@/lib/hints/ladder";
import { applyDemonstrated, applyRepair, applyTransfer, applyWeakness, freshState, mastery, skillStatus } from "@/lib/skills/model";

const base: LadderState = { evaluated: true, maxRungRevealed: -1, revealedAt: {}, rewriteSubmitted: false };
const opts = { exemplarWaitMinutes: 10 };

describe("hint ladder state machine", () => {
  it("requires an evaluated attempt", () => {
    expect(canReveal({ ...base, evaluated: false }, 0, opts)).toMatchObject({ ok: false, code: "EVALUATION_REQUIRED" });
  });
  it("opens rungs 0-3 strictly in order", () => {
    expect(canReveal(base, 0, opts).ok).toBe(true);
    expect(canReveal(base, 1, opts).ok).toBe(false);
    let s = reveal(base, 0);
    expect(canReveal(s, 1, opts).ok).toBe(true);
    expect(canReveal(s, 2, opts).ok).toBe(false);
    s = reveal(reveal(s, 1), 2);
    expect(canReveal(s, 3, opts).ok).toBe(true);
  });
  it("exemplar (4) needs a rewrite or a wait after the dossier", () => {
    const now = new Date("2026-10-16T10:00:00Z");
    let s = reveal(reveal(reveal(reveal(base, 0), 1), 2), 3, now);
    expect(canReveal(s, 4, { ...opts, now: new Date(now.getTime() + 60_000) })).toMatchObject({ ok: false, code: "RUNG_LOCKED" });
    expect(canReveal(s, 4, { ...opts, now: new Date(now.getTime() + 11 * 60_000) }).ok).toBe(true);
    s = { ...reveal(base, 0), rewriteSubmitted: true };
    expect(canReveal(s, 4, opts).ok).toBe(true);
  });
  it("full sample (5) needs rung 3 and explicit confirmation", () => {
    expect(canReveal(base, 5, { ...opts, confirm: true }).ok).toBe(false);
    const s = reveal(reveal(reveal(reveal(base, 0), 1), 2), 3);
    expect(canReveal(s, 5, opts).ok).toBe(false);
    expect(canReveal(s, 5, { ...opts, confirm: true }).ok).toBe(true);
  });
  it("re-opening an already revealed rung is allowed", () => {
    expect(canReveal(reveal(base, 0), 0, opts).ok).toBe(true);
  });
});

describe("skill model", () => {
  it("weakness lowers mastery more for severe issues", () => {
    const m = mastery(applyWeakness(freshState(), "minor"));
    const M = mastery(applyWeakness(freshState(), "major"));
    expect(M).toBeLessThan(m);
  });
  it("transfer counts more than repair", () => {
    const w = applyWeakness(freshState(), "moderate");
    expect(mastery(applyTransfer(w, true))).toBeGreaterThan(mastery(applyRepair(w)));
    expect(mastery(applyDemonstrated(w))).toBeGreaterThan(mastery(w));
  });
  it("status distinguishes repair from transfer", () => {
    let s = applyWeakness(freshState(), "moderate");
    expect(skillStatus(s, 1)).toBe("improving");
    s = applyRepair(s);
    expect(skillStatus(s, 1)).toBe("fixed_when_prompted");
    expect(skillStatus(applyTransfer(s, true), 1)).toBe("holds_on_new_questions");
    expect(skillStatus(applyTransfer(s, false), 4)).toBe("recurring");
  });
});
