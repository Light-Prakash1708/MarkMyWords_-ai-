/**
 * Skill model. Each (user, skill tag, paper) has a Beta(alpha, beta) posterior over "the student
 * avoids this weakness". Weakness occurrences add to beta (weighted by severity); demonstrated
 * strength and — most strongly — absence on a fresh transfer question add to alpha.
 *
 * Repair (fixed in a rewrite after feedback) and transfer (absent on a NEW question with no hints)
 * are tracked separately: only transfer is evidence of learning.
 */
export const SEVERITY_BETA = { minor: 0.5, moderate: 1, major: 1.5 } as const;
export const ALPHA_DEMONSTRATED = 0.5;
export const ALPHA_REPAIR = 0.25;
export const ALPHA_TRANSFER = 1.5;
export const BETA_TRANSFER_FAIL = 1;

export interface SkillState {
  alpha: number;
  beta: number;
  occurrences: number;
  repair_count: number;
  transfer_success_count: number;
  transfer_attempt_count: number;
  last_transfer_result: "passed" | "failed" | null;
}

export const freshState = (): SkillState => ({
  alpha: 1,
  beta: 1,
  occurrences: 0,
  repair_count: 0,
  transfer_success_count: 0,
  transfer_attempt_count: 0,
  last_transfer_result: null,
});

export const mastery = (s: Pick<SkillState, "alpha" | "beta">) => s.alpha / (s.alpha + s.beta);

export function applyWeakness(s: SkillState, severity: keyof typeof SEVERITY_BETA): SkillState {
  return { ...s, beta: s.beta + SEVERITY_BETA[severity], occurrences: s.occurrences + 1 };
}
export function applyDemonstrated(s: SkillState): SkillState {
  return { ...s, alpha: s.alpha + ALPHA_DEMONSTRATED };
}
export function applyRepair(s: SkillState): SkillState {
  return { ...s, alpha: s.alpha + ALPHA_REPAIR, repair_count: s.repair_count + 1 };
}
export function applyTransfer(s: SkillState, passed: boolean): SkillState {
  return passed
    ? { ...s, alpha: s.alpha + ALPHA_TRANSFER, transfer_success_count: s.transfer_success_count + 1, transfer_attempt_count: s.transfer_attempt_count + 1, last_transfer_result: "passed" }
    : { ...s, beta: s.beta + BETA_TRANSFER_FAIL, transfer_attempt_count: s.transfer_attempt_count + 1, last_transfer_result: "failed" };
}

export type SkillStatus = "holds_on_new_questions" | "fixed_when_prompted" | "recurring" | "improving" | "not_yet_observed";

export function skillStatus(s: SkillState, recentOccurrences: number): SkillStatus {
  if (s.last_transfer_result === "passed") return "holds_on_new_questions";
  if (recentOccurrences >= 3) return "recurring";
  if (s.repair_count > 0) return "fixed_when_prompted";
  if (s.occurrences === 0) return "not_yet_observed";
  return "improving";
}

export const STATUS_LABEL: Record<SkillStatus, string> = {
  holds_on_new_questions: "Holds on new questions",
  fixed_when_prompted: "Fixed when prompted",
  recurring: "Recurring",
  improving: "Watching",
  not_yet_observed: "Not yet observed",
};
