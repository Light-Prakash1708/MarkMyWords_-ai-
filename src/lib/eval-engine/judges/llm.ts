import { getEnv } from "../../env";
import type { LlmProvider } from "../../llm/types";
import { RawJudgementSchema, rawJudgementJsonSchema, type EvaluationInput } from "../../schemas/evaluation";
import { buildJudgePrompt, JUDGE_PROMPT_VERSION } from "../prompt";
import type { Judge, JudgeOutput } from "./types";

/** Model-backed judge. Each sample uses a fresh nonce and slightly different temperature. */
export class LlmJudge implements Judge {
  readonly name: string;
  readonly promptVersion = JUDGE_PROMPT_VERSION;
  constructor(
    private readonly provider: LlmProvider,
    private readonly model = getEnv().judgeModel,
  ) {
    this.name = provider.name;
  }

  async judge(input: EvaluationInput, sampleIndex: number): Promise<JudgeOutput> {
    const { system, user } = buildJudgePrompt(input);
    const res = await this.provider.structured({
      task: "judge",
      model: this.model,
      system,
      content: [{ type: "text", text: user }],
      schema: RawJudgementSchema,
      jsonSchema: rawJudgementJsonSchema(),
      toolName: "submit_judgement",
      toolDescription: "Submit the structured judgement of the student's answer against the rubric.",
      maxTokens: 4000,
      temperature: sampleIndex === 0 ? 0.2 : 0.5,
    });
    return { raw: res.output, usage: res.usage, model: res.model };
  }
}
