import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { z } from "zod";
import { getEnv } from "../env";
import { RubricTemplateSchema, type RubricTemplate } from "../schemas/rubric";

/**
 * Exam configuration is DATA. Code never branches on a specific exam code — every exam-specific
 * behaviour comes from these validated config files (see tests/unit/no-exam-literals.test.ts).
 */

export const QuestionTypeSchema = z.object({
  code: z.string().min(1),
  marks: z.number().positive().nullable(),
  word_limit: z.number().int().positive().nullable(),
  time_budget_min: z.number().int().positive(),
  word_tolerance_pct: z.number().int().min(0).max(100),
});

export const SyllabusNodeSchema = z.object({
  code: z.string().min(1),
  title: z.string().min(1),
  parent_code: z.string().optional(),
  micro_topics: z.array(z.string()).default([]),
});

export const PaperSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  subtitle: z.string().optional(),
  total_marks: z.number().int().positive().nullable(),
  duration_min: z.number().int().positive().nullable(),
  default_input_mode: z.enum(["typed", "handwritten"]),
  fact_source_url: z.string().url(),
  official_reference_url: z.string().url().optional(),
  verified_on: z.union([z.string(), z.date()]).transform((v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v)),
  verification_status: z.enum(["official", "secondary", "unverified"]),
  question_types: z.array(QuestionTypeSchema).min(1),
  syllabus: z.array(SyllabusNodeSchema).min(1),
  status: z.enum(["active", "inactive"]),
});

export const ExamConfigSchema = z.object({
  exam: z.object({
    code: z.string().regex(/^[A-Z][A-Z0-9_]+$/),
    name: z.string(),
    short_name: z.string(),
    status: z.enum(["active", "inactive"]),
    /** live = fully launched; preview = usable and clearly labelled while content and rubric mature. */
    stage: z.enum(["live", "preview"]).default("live"),
    config_version: z.string(),
    input_modes: z.array(z.enum(["typed", "handwritten"])).min(1),
    default_input_mode: z.enum(["typed", "handwritten"]),
    ux: z.object({
      show_handwriting_upload: z.boolean(),
      show_presentation_feedback: z.boolean(),
      show_typing_speed: z.boolean(),
      editor_style: z.enum(["ruled_sheet", "exam_terminal"]),
    }),
  }),
  papers: z.array(PaperSchema).min(1),
});
export type ExamConfig = z.infer<typeof ExamConfigSchema>;

export const DirectiveSchema = z.object({
  code: z.string(),
  label: z.string(),
  demand: z.string(),
  expected_moves: z.array(z.string()),
});
export type Directive = z.infer<typeof DirectiveSchema>;

export const SkillSchema = z.object({ code: z.string(), name: z.string(), group: z.string() });
export type Skill = z.infer<typeof SkillSchema>;

export const QuestionPartSchema = z.object({
  id: z.string(),
  demand: z.string(),
  cues: z.array(z.string()).default([]),
});
export type QuestionPart = z.infer<typeof QuestionPartSchema>;

export const QuestionContentSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/),
  question_type: z.string(),
  text: z.string().min(20),
  parts: z.array(QuestionPartSchema).min(1),
  directive_codes: z.array(z.string()).min(1),
  syllabus_codes: z.array(z.string()).min(1),
  dimensions_expected: z.array(z.string()).default([]),
  priority_reasons: z.array(z.string()).default([]),
  skill_tags_targeted: z.array(z.string()).default([]),
  dossier: z
    .object({
      reveal_policy: z.enum(["pre_attempt_allowed", "post_attempt_only"]),
      source_slugs: z.array(z.string()).default([]),
    })
    .default({ reveal_policy: "post_attempt_only", source_slugs: [] }),
});
export const QuestionFileSchema = z.object({
  exam_code: z.string(),
  paper_code: z.string(),
  note: z.string().optional(),
  questions: z.array(QuestionContentSchema),
});
export type QuestionContent = z.infer<typeof QuestionContentSchema>;

export const HeuristicCheckSchema = z.object({
  id: z.string(),
  claim_pattern: z.string(),
  context_pattern: z.string().optional(),
  exclude_pattern: z.string().optional(),
  expected_pattern: z.string(),
  quote: z.string(),
  note: z.string(),
});
export type HeuristicCheck = z.infer<typeof HeuristicCheckSchema>;

export const SourceContentSchema = z.object({
  slug: z.string(),
  kind: z.string(),
  text_kind: z.enum(["verbatim", "our_summary", "link_only"]),
  title: z.string(),
  publisher: z.string(),
  official_url: z.string().url(),
  published_on: z.string().nullable(),
  license: z.string(),
  stale_after_days: z.number().int().positive().nullable(),
  chunks: z.array(z.string().min(10)),
  heuristic_checks: z.array(HeuristicCheckSchema).default([]),
});
export const SourceFileSchema = z.object({ note: z.string().optional(), sources: z.array(SourceContentSchema) });
export type SourceContent = z.infer<typeof SourceContentSchema>;

function readYaml(file: string): unknown {
  return YAML.parse(fs.readFileSync(file, "utf8"), { maxAliasCount: 50 });
}

export function loadExamConfigs(dir = path.join(getEnv().configDir, "exams")): ExamConfig[] {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
  const configs = files.sort().map((f) => {
    const parsed = ExamConfigSchema.safeParse(readYaml(path.join(dir, f)));
    if (!parsed.success) throw new Error(`Invalid exam config ${f}: ${parsed.error.message}`);
    return parsed.data;
  });
  const codes = new Set<string>();
  for (const c of configs) {
    if (codes.has(c.exam.code)) throw new Error(`Duplicate exam code ${c.exam.code}`);
    codes.add(c.exam.code);
    if (!c.exam.input_modes.includes(c.exam.default_input_mode)) {
      throw new Error(`${c.exam.code}: default_input_mode must be one of input_modes`);
    }
  }
  return configs;
}

export function loadDirectives(file = path.join(getEnv().configDir, "directives.yaml")): Directive[] {
  return z.object({ directives: z.array(DirectiveSchema) }).parse(readYaml(file)).directives;
}

export function loadSkills(file = path.join(getEnv().configDir, "skills.yaml")): Skill[] {
  return z.object({ skills: z.array(SkillSchema) }).parse(readYaml(file)).skills;
}

export function loadRubricTemplates(dir = path.join(getEnv().configDir, "rubrics")): RubricTemplate[] {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => {
      const parsed = RubricTemplateSchema.safeParse(JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")));
      if (!parsed.success) throw new Error(`Invalid rubric ${f}: ${parsed.error.message}`);
      const sum = parsed.data.criteria.reduce((s, c) => s + c.weight, 0);
      if (Math.abs(sum - 1) > 1e-6) throw new Error(`Rubric ${f}: weights sum to ${sum}, expected 1`);
      return parsed.data;
    });
}

export function loadQuestionFiles(dir = path.join(getEnv().contentDir, "questions")) {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => QuestionFileSchema.parse(JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"))));
}

export function loadSourceFiles(dir = path.join(getEnv().contentDir, "sources")) {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => SourceFileSchema.parse(JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"))));
}

export const TrialConfigSchema = z.object({
  trial: z.object({
    answers_per_exam: z.number().int().min(1).max(10),
    rewrites_per_question: z.number().int().min(0).max(3),
    guest_session_days: z.number().int().min(1).max(30),
    max_new_guests_per_ip_per_day: z.number().int().min(1),
    max_new_guests_per_day: z.number().int().min(1),
    max_guest_evaluations_per_day: z.number().int().min(1),
    purge_guests_after_days: z.number().int().min(1),
    questions: z.record(z.string(), z.array(z.string()).min(1)),
  }),
});
export type TrialConfig = z.infer<typeof TrialConfigSchema>["trial"];

/** Guest-trial settings (config/trial.yaml). */
export function loadTrialConfig(file = path.join(getEnv().configDir, "trial.yaml")): TrialConfig {
  return TrialConfigSchema.parse(readYaml(file)).trial;
}
