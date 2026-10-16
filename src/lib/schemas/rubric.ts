import { z } from "zod";

export const InputSourceSchema = z.enum(["typed", "handwritten", "student_transcribed", "ocr_confirmed"]);

export const RubricBandSchema = z.object({
  band: z.number().int().min(0),
  descriptor_id: z.string(),
  descriptor: z.string(),
  indicators: z.array(z.string()).default([]),
  common_failures: z.array(z.string()).default([]),
});

export const RubricCriterionSchema = z.object({
  code: z.string().regex(/^[A-Z_]+$/),
  name: z.string(),
  weight: z.number().positive().max(1),
  input_modes: z.array(InputSourceSchema).min(1),
  skill_tags: z.array(z.string()).min(1),
  notes_for_evaluator: z.string(),
  bands: z.array(RubricBandSchema).min(2),
});
export type RubricCriterion = z.infer<typeof RubricCriterionSchema>;

export const RubricTemplateSchema = z.object({
  template_code: z.string(),
  title: z.string(),
  exam_code: z.string(),
  paper_codes: z.array(z.string()).min(1),
  question_type_codes: z.array(z.string()).min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  status: z.enum(["draft", "calibrating", "active", "retired"]),
  aggregation: z.literal("weighted_bands"),
  max_band: z.number().int().min(2).max(10),
  disclaimer: z.string(),
  changelog: z.string(),
  criteria: z.array(RubricCriterionSchema).min(2),
});
export type RubricTemplate = z.infer<typeof RubricTemplateSchema>;

/** The immutable rubric version an evaluation runs against (embedded in EvaluationInput). */
export const RubricVersionSchema = z.object({
  id: z.string(),
  rubric_code: z.string(),
  version: z.string(),
  status: z.enum(["draft", "calibrating", "active", "retired"]),
  max_band: z.number().int(),
  disclaimer: z.string(),
  criteria: z.array(RubricCriterionSchema),
});
export type RubricVersion = z.infer<typeof RubricVersionSchema>;
