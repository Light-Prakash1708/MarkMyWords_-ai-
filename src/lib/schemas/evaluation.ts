import { z } from "zod";
import { RubricVersionSchema } from "./rubric";

/**
 * The evaluation contract. EvaluationInput goes into the engine; EvaluationResult is the ONLY shape
 * the UI consumes. RawJudgement is what an individual judge (LLM or heuristic) returns per sample —
 * it contains quotes, never offsets or totals; code turns quotes into spans and bands into marks.
 * See docs/evaluation-spec.md.
 */

export const SCHEMA_VERSION = "1.0.0";
export const ENGINE_VERSION = "mmw-engine-1.0.0";

export const SpanSchema = z.object({
  start: z.number().int().min(0),
  end: z.number().int().min(0),
  quote: z.string().min(1),
});
export type Span = z.infer<typeof SpanSchema>;

export const CitationSchema = z.object({
  source_chunk_id: z.string(),
  source_title: z.string(),
  source_url: z.string(),
  published_on: z.string().nullable(),
  quote: z.string().min(1),
  text_kind: z.enum(["verbatim", "our_summary", "link_only"]),
  verification_status: z.enum(["verified", "unverified"]),
  may_be_outdated: z.boolean(),
});
export type Citation = z.infer<typeof CitationSchema>;

export const UncertainSpanSchema = z.object({
  start: z.number().int().min(0),
  end: z.number().int().min(0),
  reason: z.string(),
});

export const RetrievedSourceSchema = z.object({
  source_chunk_id: z.string(),
  source_id: z.string(),
  title: z.string(),
  url: z.string(),
  published_on: z.string().nullable(),
  text: z.string(),
  text_kind: z.enum(["verbatim", "our_summary", "link_only"]),
  verification_status: z.enum(["verified", "unverified"]),
  stale_after_days: z.number().nullable(),
});
export type RetrievedSource = z.infer<typeof RetrievedSourceSchema>;

export const EvaluationInputSchema = z.object({
  attempt_id: z.string(),
  exam: z.object({ code: z.string(), config_version: z.string() }),
  paper: z.object({ code: z.string(), name: z.string() }),
  question: z.object({
    id: z.string(),
    version: z.number().int(),
    text: z.string(),
    parts: z.array(z.object({ id: z.string(), demand: z.string(), cues: z.array(z.string()).default([]) })),
    directive_codes: z.array(z.string()),
    directives: z.array(z.object({ code: z.string(), label: z.string(), demand: z.string(), expected_moves: z.array(z.string()) })),
    marks: z.number().positive(),
    word_limit: z.number().int().positive().nullable(),
    word_tolerance_pct: z.number().int(),
    syllabus_codes: z.array(z.string()),
    dimensions_expected: z.array(z.string()),
  }),
  rubric_version: RubricVersionSchema,
  transcript: z.object({
    version: z.number().int(),
    text: z.string(),
    source: z.enum(["typed", "ocr_confirmed", "student_transcribed"]),
    input_mode: z.enum(["typed", "handwritten"]),
    uncertain_spans: z.array(UncertainSpanSchema),
    diagrams: z.array(z.object({ page: z.number().int(), description: z.string(), student_caption: z.string().optional() })),
    word_count: z.number().int().min(0),
  }),
  context: z.object({
    retrieved_sources: z.array(RetrievedSourceSchema),
    heuristic_checks: z.array(z.any()).default([]),
    time_spent_sec: z.number().int().nullable(),
    timer_mode: z.enum(["exam", "untimed"]),
    attempt_kind: z.enum(["first", "rewrite", "transfer_retest"]),
    prior_evaluation_summary: z
      .object({
        comments: z.array(z.object({ id: z.string(), skill_tag: z.string(), severity: z.string(), message: z.string(), kind: z.string() })),
      })
      .nullable(),
    skill_tags: z.array(z.string()),
    self_assessment: z.array(z.object({ criterion_code: z.string(), band: z.number().int() })).nullable(),
  }),
  engine: z.object({ engine_version: z.string(), prompt_version: z.string(), samples: z.number().int().min(1).max(5) }),
});
export type EvaluationInput = z.infer<typeof EvaluationInputSchema>;

const Severity = z.enum(["minor", "moderate", "major"]);
const CommentKind = z.enum(["strength", "weakness", "factual_error", "missing_dimension", "structure", "presentation"]);

/** What a single judge sample returns. Quotes only — no offsets, no totals. */
export const RawJudgementSchema = z.object({
  criteria: z
    .array(
      z.object({
        code: z.string(),
        band: z.number().int().min(0).max(10),
        descriptor_id: z.string(),
        rationale: z.string().max(600),
      }),
    )
    .min(1),
  parts: z.array(
    z.object({
      part_id: z.string(),
      addressed: z.enum(["fully", "partially", "not"]),
      quotes: z.array(z.string()).max(4),
    }),
  ),
  directives: z.array(
    z.object({ directive: z.string(), met: z.boolean(), explanation: z.string().max(400), quotes: z.array(z.string()).max(4) }),
  ),
  comments: z
    .array(
      z.object({
        criterion_code: z.string(),
        skill_tag: z.string(),
        kind: CommentKind,
        severity: Severity,
        message: z.string().min(10).max(600),
        quotes: z.array(z.string()).max(3),
        question_part_id: z.string().nullable().optional(),
        rubric_descriptor_id: z.string().nullable().optional(),
        suggestion: z.string().max(400),
        citations: z.array(z.object({ source_chunk_id: z.string(), quote: z.string() })).max(3),
        uncertain: z.boolean(),
        uncertainty_reason: z.string().nullable().optional(),
      }),
    )
    .max(16),
  factual_checks: z
    .array(
      z.object({
        claim_quote: z.string(),
        verdict: z.enum(["supported", "contradicted", "outdated", "unverifiable"]),
        citations: z.array(z.object({ source_chunk_id: z.string(), quote: z.string() })).max(3),
        note: z.string().max(400),
      }),
    )
    .max(10),
  next_action_instruction: z.string().max(400),
  rewrite_delta: z
    .array(
      z.object({
        prior_comment_id: z.string(),
        status: z.enum(["resolved", "partially", "unresolved", "regressed"]),
        quotes: z.array(z.string()).max(3),
      }),
    )
    .optional(),
});
export type RawJudgement = z.infer<typeof RawJudgementSchema>;

export const CommentSchema = z.object({
  id: z.string(),
  criterion_code: z.string(),
  skill_tag: z.string(),
  kind: CommentKind,
  severity: Severity,
  message: z.string(),
  evidence: z.object({
    answer_spans: z.array(SpanSchema),
    question_part_id: z.string().nullable(),
    rubric_descriptor_id: z.string().nullable(),
    citations: z.array(CitationSchema),
  }),
  suggestion: z.string(),
  uncertain: z.boolean(),
  uncertainty_reason: z.string().nullable(),
  sample_support: z.number().int().min(0),
});
export type EvalComment = z.infer<typeof CommentSchema>;

export const EvaluationResultSchema = z.object({
  schema_version: z.literal(SCHEMA_VERSION),
  score_kind: z.literal("ai_estimate"),
  disclaimer_version: z.string(),
  evaluator: z.object({
    provider: z.enum(["anthropic", "heuristic", "mock"]),
    is_ai: z.boolean(),
    label: z.string(),
    engine_version: z.string(),
    prompt_version: z.string(),
    model_ids: z.array(z.string()),
  }),
  rubric: z.object({ version_id: z.string(), code: z.string(), version: z.string(), status: z.string() }),
  total: z.object({
    point_estimate: z.number().min(0),
    range: z.object({ low: z.number().min(0), high: z.number().min(0) }),
    max: z.number().positive(),
    confidence: z.enum(["high", "medium", "low"]),
    confidence_reasons: z.array(z.string()),
  }),
  question_demand_analysis: z.object({
    parts: z.array(
      z.object({
        part_id: z.string(),
        demand: z.string(),
        addressed: z.enum(["fully", "partially", "not"]),
        evidence_spans: z.array(SpanSchema),
      }),
    ),
    directive_compliance: z.array(
      z.object({ directive: z.string(), met: z.boolean(), explanation: z.string(), evidence_spans: z.array(SpanSchema) }),
    ),
  }),
  criteria: z.array(
    z.object({
      code: z.string(),
      name: z.string(),
      band: z.number().int().min(0),
      max_band: z.number().int().min(1),
      band_range: z.object({ low: z.number().int(), high: z.number().int() }),
      marks_awarded: z.number().min(0),
      marks_max: z.number().min(0),
      rationale: z.string(),
      descriptor_matched: z.string(),
      descriptor_text: z.string(),
    }),
  ),
  comments: z.array(CommentSchema),
  factual_checks: z.array(
    z.object({
      claim_span: SpanSchema,
      verdict: z.enum(["supported", "contradicted", "outdated", "unverifiable"]),
      citations: z.array(CitationSchema),
      note: z.string(),
      method: z.enum(["llm", "pattern"]),
    }),
  ),
  word_limit: z.object({
    count: z.number().int(),
    limit: z.number().int().nullable(),
    status: z.enum(["under", "within", "over", "no_limit"]),
  }),
  top_priorities: z.array(z.object({ comment_id: z.string(), why_first: z.string() })).max(3),
  next_action: z.object({
    type: z.enum(["rewrite_section", "retest", "study_source"]),
    target_skill_tags: z.array(z.string()),
    instruction: z.string(),
  }),
  self_assessment_gap: z
    .array(z.object({ criterion_code: z.string(), self_band: z.number().int(), ai_band: z.number().int() }))
    .nullable(),
  rewrite_delta: z
    .array(
      z.object({
        prior_comment_id: z.string(),
        prior_message: z.string(),
        skill_tag: z.string(),
        status: z.enum(["resolved", "partially", "unresolved", "regressed"]),
        evidence_spans: z.array(SpanSchema),
      }),
    )
    .nullable(),
  diagnostics: z.object({
    samples_run: z.number().int(),
    band_spread_by_criterion: z.record(z.string(), z.number()),
    validator_repairs: z.number().int(),
    validator_notes: z.array(z.string()),
    input_tokens: z.number().int(),
    output_tokens: z.number().int(),
  }),
});
export type EvaluationResult = z.infer<typeof EvaluationResultSchema>;

/** JSON Schema for the per-sample judge output, used as the LLM tool input_schema. */
export function rawJudgementJsonSchema(): Record<string, unknown> {
  const s = z.toJSONSchema(RawJudgementSchema) as Record<string, unknown>;
  delete s.$schema;
  return s;
}
