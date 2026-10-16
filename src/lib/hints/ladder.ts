/**
 * Hint ladder — a server-enforced state machine (principles P1 and P2).
 *
 *  0 Diagnosis (top priorities)          → after evaluation
 *  1 Targeted hints (nudges, not text)   → on request, after rung 0
 *  2 Outline skeleton for weak sections  → on request, after rung 1
 *  3 Source dossier for the gaps         → on request, after rung 2
 *  4 One exemplar paragraph              → after a rewrite was submitted, OR rung 3 seen ≥ N minutes ago
 *  5 Full sample answer                  → explicit confirmation, after rung 3; logged
 */
export const RUNGS = [
  { rung: 0, title: "Diagnosis", blurb: "Your top priorities, with the evidence from your answer." },
  { rung: 1, title: "Targeted hints", blurb: "A nudge per priority — a question to think about, not text to copy." },
  { rung: 2, title: "Outline for the weak parts", blurb: "A skeleton for only the sections that lost marks." },
  { rung: 3, title: "Source dossier", blurb: "Cited source material for the gaps in your answer." },
  { rung: 4, title: "One exemplar paragraph", blurb: "A single model paragraph for your weakest criterion." },
  { rung: 5, title: "Full sample answer", blurb: "An AI-generated illustration of one possible answer. Last resort." },
] as const;

export interface LadderState {
  evaluated: boolean;
  maxRungRevealed: number; // -1 = nothing revealed yet
  revealedAt: Record<number, string>; // rung -> ISO time
  rewriteSubmitted: boolean;
}

export interface RevealCheck {
  ok: boolean;
  code?: "EVALUATION_REQUIRED" | "RUNG_LOCKED";
  reason?: string;
  unlocksAt?: string;
}

export function canReveal(state: LadderState, rung: number, opts: { confirm?: boolean; now?: Date; exemplarWaitMinutes: number }): RevealCheck {
  const now = opts.now ?? new Date();
  if (rung < 0 || rung > 5 || !Number.isInteger(rung)) return { ok: false, code: "RUNG_LOCKED", reason: "Unknown rung." };
  if (!state.evaluated) return { ok: false, code: "EVALUATION_REQUIRED", reason: "Submit and evaluate your own attempt first." };
  if (rung <= state.maxRungRevealed) return { ok: true };
  if (rung >= 1 && rung <= 3 && state.maxRungRevealed < rung - 1) {
    return { ok: false, code: "RUNG_LOCKED", reason: `Open "${RUNGS[rung - 1].title}" first.` };
  }
  if (rung === 4) {
    if (state.rewriteSubmitted) return { ok: true };
    if (state.maxRungRevealed < 3) return { ok: false, code: "RUNG_LOCKED", reason: "Try a rewrite first, or work through the dossier." };
    const seen = state.revealedAt[3] ? new Date(state.revealedAt[3]).getTime() : now.getTime();
    const unlock = seen + opts.exemplarWaitMinutes * 60_000;
    if (now.getTime() < unlock) {
      return { ok: false, code: "RUNG_LOCKED", reason: "Give your own rewrite a try first — the exemplar unlocks shortly.", unlocksAt: new Date(unlock).toISOString() };
    }
    return { ok: true };
  }
  if (rung === 5) {
    if (state.maxRungRevealed < 3) return { ok: false, code: "RUNG_LOCKED", reason: "Work through the hints, outline and dossier before the full sample." };
    if (!opts.confirm) return { ok: false, code: "RUNG_LOCKED", reason: "Confirm that you want to see a full sample answer." };
    return { ok: true };
  }
  return { ok: true };
}

export function reveal(state: LadderState, rung: number, now = new Date()): LadderState {
  return {
    ...state,
    maxRungRevealed: Math.max(state.maxRungRevealed, rung),
    revealedAt: { ...state.revealedAt, [rung]: state.revealedAt[rung] ?? now.toISOString() },
  };
}
