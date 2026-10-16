import type { Usage } from "../../llm/types";
import type { EvaluationInput, RawJudgement } from "../../schemas/evaluation";

export interface JudgeOutput {
  raw: RawJudgement;
  usage: Usage;
  model: string;
}

/** One independent judgement of an answer. The engine runs `samples` of these and aggregates. */
export interface Judge {
  readonly name: string;
  readonly promptVersion: string;
  judge(input: EvaluationInput, sampleIndex: number): Promise<JudgeOutput>;
}
