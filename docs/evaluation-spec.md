# Evaluation specification (v1.0)

This document is the contract for MarkMyWords' evaluation engine. The code of record is `src/lib/schemas/evaluation.ts` (Zod), `src/lib/eval-engine/` and `config/rubrics/`.

## 1. Principles the engine enforces

1. **AI estimate, never official.** `score_kind` is the literal `"ai_estimate"` in the schema and in a DB `CHECK` constraint. Every score display requires a `Disclaimer` prop.
2. **Totals are computed by code.** The judge returns bands per criterion. Code maps bands to marks using the rubric weights.
3. **Evidence or uncertainty.** Judges return *quotes*, never offsets. Code locates each quote in the transcript: exact match, then a whitespace- and quote-normalised match, then a case-insensitive match. Quotes that cannot be found are discarded and counted in `diagnostics.validator_repairs`. Spans always equal `transcript.slice(start, end)`.
4. **Citations must verify.** A citation survives only if its chunk was retrieved for this evaluation *and* its quote is an exact substring of that chunk. A `factual_error` without a verified citation becomes `uncertain` (`no_supporting_source`). A `contradicted` or `outdated` verdict without one becomes `unverifiable`.
5. **Untrusted input.** Student text is wrapped in random-nonce delimiters, and any forged delimiters or tags are neutralised. The system prompt declares the text untrusted. Lines addressing the evaluator are detected deterministically, flagged and earn no credit.
6. **No answer writing in feedback.** Suggestions are capped at 40 words, and banned phrasing (official marks, guarantees, predictions, "topper answer") is stripped. Negated forms ("not official marks") are allowed.

## 2. Input — `EvaluationInput`

`attempt_id`, `exam {code, config_version}`, `paper {code, name}`, `question {id, version, text, parts[{id, demand, cues}], directive_codes, directives[{code, label, demand, expected_moves}], marks, word_limit, word_tolerance_pct, syllabus_codes, dimensions_expected}`, `rubric_version` (full, immutable), `transcript {version, text (NFC), source: typed|ocr_confirmed|student_transcribed, input_mode: typed|handwritten, uncertain_spans[{start,end,reason}], diagrams[], word_count (code)}`, `context {retrieved_sources[], time_spent_sec, timer_mode, attempt_kind: first|rewrite|transfer_retest, prior_evaluation_summary (rewrites), skill_tags (allowed vocabulary), self_assessment}`, `engine {engine_version, prompt_version, samples}`.

## 3. Per-sample judge output — `RawJudgement`

`criteria[{code, band, descriptor_id, rationale}]`, `parts[{part_id, addressed: fully|partially|not, quotes[]}]`, `directives[{directive, met, explanation, quotes[]}]`, `comments[{criterion_code, skill_tag, kind, severity, message, quotes[], question_part_id?, rubric_descriptor_id?, suggestion, citations[{source_chunk_id, quote}], uncertain, uncertainty_reason?}]`, `factual_checks[{claim_quote, verdict, citations[], note}]`, `next_action_instruction`, `rewrite_delta?[{prior_comment_id, status, quotes[]}]`.

For the LLM judge this is the tool `input_schema`, generated from Zod with `z.toJSONSchema`. The rule-based demo judge emits the same shape.

## 4. Output — `EvaluationResult`

`score_kind`, `disclaimer_version`, `evaluator {provider, is_ai, label, engine_version, prompt_version, model_ids}`, `rubric {version_id, code, version, status}`, `total {point_estimate, range{low,high}, max, confidence: high|medium|low, confidence_reasons[]}`, `question_demand_analysis {parts[], directive_compliance[]}`, `criteria[{code, name, band, max_band, band_range, marks_awarded, marks_max, rationale, descriptor_matched, descriptor_text}]`, `comments[{id, …, evidence{answer_spans[], question_part_id, rubric_descriptor_id, citations[]}, suggestion, uncertain, uncertainty_reason, sample_support}]`, `factual_checks[{claim_span, verdict, citations[], note, method: llm|pattern}]`, `word_limit {count, limit, status: under|within|over|no_limit}`, `top_priorities[≤3]`, `next_action`, `self_assessment_gap`, `rewrite_delta`, `diagnostics {samples_run, band_spread_by_criterion, validator_repairs, validator_notes, input_tokens, output_tokens}`.

## 5. Scoring algorithm

1. **Code** computes the word count, word-limit status and injection lines.
2. **Retrieval** returns sources linked to the question plus SQLite FTS5 BM25 hits, keeping hits within 45% of the best score. Only these chunks may be cited.
3. **Samples:** `MMW_EVAL_SAMPLES` (default 3) independent judge calls at temperatures 0.2/0.5/0.5. The rule-based judge is deterministic and runs once.
4. **Median band** per enabled criterion; `spread = max − min`. Criteria not enabled for the input mode (e.g. Presentation for typed answers) are dropped, and the remaining weights are renormalised.
5. **Marks** = `question_marks × weight / Σweights × band / max_band`. Total = sum. The range comes from per-criterion min/max bands, widened by the share of uncertain transcript, with a minimum of ±0.5 whenever confidence is not high.
6. **Comments** are clustered across samples by skill tag and span overlap. If fewer than ⌈n/2⌉ samples support a comment, it is marked uncertain.
7. **Engine-level deterministic checks** run on top: injection lines, the over-limit and too-short notes, and pattern fact checks (each tied to a corpus quote). A verified factual error caps Evidence at band 2. It is applied once, never double-penalised.
8. **Confidence** starts `high` and is downgraded for: a rule-based evaluator, a single sample, sample disagreement (spread ≥ 2 → low; = 1 → medium), uncertain OCR (> 15% of characters → low), a very short answer, a possibly off-topic answer, or failed samples.
9. **Validators** (`validateResult`) re-check everything strictly. Any remaining violations are recorded in `diagnostics.validator_notes`. In tests and benchmarks they must be zero.

## 6. Rubric (UPSC GS, v0.1.0 — *calibrating*)

| Criterion | Weight | Skill tags |
|---|---|---|
| Question demand & directive | 15% | DEMAND.parts_missed, DEMAND.directive_misread |
| Content & dimensions | 20% | CONTENT.dimension_gap, CONTENT.irrelevance |
| Analysis & reasoning | 25% | ANALYSIS.mechanism_missing, no_judgement, one_sided |
| Evidence & accuracy | 15% | EVIDENCE.unsupported_claim, factual_error, outdated_data, no_examples |
| Structure & flow | 10% | STRUCTURE.weak_intro, weak_conclusion, poor_flow — judged by **function, not template** |
| Presentation (handwritten only) | 5% | PRESENTATION.no_visuals, legibility |
| Precision & language | 10% | LANGUAGE.verbosity, imprecise_terms, TIME.over_limit, TIME.incomplete |

Each criterion has bands 0–4 with descriptor IDs (e.g. `ANALYSIS.3`). This is MarkMyWords' own framework, not UPSC's.

## 7. Uncertainty rules

A comment is `uncertain` when it:
- is supported by a minority of samples;
- relies on an uncertain OCR region;
- is a factual error without a verified citation;
- fails the genericity check (no shared vocabulary with its own evidence or the question); or
- is marked uncertain by the judge.

The UI shows uncertain comments with a "Why uncertain?" disclosure and excludes them from top priorities and from the error ledger.

## 8. Rule-based demo judge

The rule-based judge is used when no AI key is configured, and as a benchmark baseline. Its signals are lexical: question-part cue words, directive move markers, a dimension lexicon, causal-link density *and* absolute count, evidence markers, paragraph structure and sentence length. Answers far below the expected length have their bands capped. Every result is labelled "rule-based demo evaluator" and has `low` confidence.

## 9. Test cases

`benchmarks/cases/base_answers.json` holds 8 base answers across 7 questions, from strong to weak. Each is marked `pending_human` and is **AI-drafted, not expert-reviewed**. Variants are generated in the runner: a removed part, a removed conclusion, a planted checkable factual error, formatting perturbations, and three injection attacks. Expert agreement (QWK, MAE) is reported as **not measured** until human-reviewed cases exist.
