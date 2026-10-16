# Build report — MarkMyWords v0.1.0 (2026-10-16)

## Execution note

The owner asked for the system to be built end to end **without approval gates**. The Phase 0 inspection ([00-inspection-report.md](00-inspection-report.md)), the evaluation contract ([evaluation-spec.md](evaluation-spec.md)) and this report were still produced, but the build did not stop at them. No destructive changes were needed: the repository was empty.

## Delivered (slices S1–S11 from BUILD_PROMPT.md)

| Slice | Status | Notes |
|---|---|---|
| S1 Foundations | ✅ | Next.js 16 + TypeScript, SQLite with reversible migrations, config loader (Zod-validated YAML), auth (scrypt, hashed session tokens, httpOnly SameSite=Lax cookies), service-layer row isolation, disclaimer system, copy lint, cost ledger |
| S2 Typed attempt | ✅ | Exam-mode editor: countdown, word meter, autosave to server and device, inline submit confirmation. P1 gate `403 ATTEMPT_REQUIRED` |
| S3 Evaluation contracts | ✅ | `docs/evaluation-spec.md`, Zod schemas, rubric v0.1.0, validators, mock provider, AI-drafted pending base cases |
| S4 Engine v1 | ✅ | Multi-sample LLM judge (Anthropic Messages API with forced tool use), rule-based demo judge, median aggregation, code-computed marks, evidence-anchored report UI, self-assessment, disputes |
| S5 Source grounding | ✅ (seed scale) | FTS5 BM25 retrieval, exact-substring citation verification, deterministic pattern fact checks, staleness flags. 21 seed sources, all *unverified* |
| S6 Hint ladder & rewrite | ✅ | Server-enforced 6-rung state machine. The rewrite is prefilled from the original, with `rewrite_delta` |
| S7 Skills & transfer | ✅ | Beta-posterior skill model, error ledger, repair vs transfer, retests scheduled at +48h, explainable recommender, weekly report, share link (no answer text) |
| S8 Handwriting | ✅ | Upload validation (magic bytes, re-encode/EXIF strip, PDF screening, page limits, quality check), vision OCR with per-line confidence, mandatory confirmation of uncertain lines, manual transcription fallback |
| S9 QOTD pipeline | ✅ | Deterministic daily pick, scheduling (human-approved only), LLM question drafting from a source → automated checks → review queue, "Why this topic matters" |
| S10 Hardening | ✅ (partial) | Rate limits, quota, global spend cap, clamd hook, export, hard delete, audit log, security headers/CSP. **Not done:** load test, a real expert gold-set benchmark |
| S11 RBI config proof | ✅ | RBI Grade B YAML present (typed-only UX flags, inactive). A test fails if exam/paper codes appear as literals in `src/` |

## Test results

| Layer | Result |
|---|---|
| TypeScript | clean |
| Unit (Vitest) | 74 tests |
| Integration (Vitest, real SQLite) | 16 tests |
| **Total Vitest** | **90 / 90 pass** |
| End-to-end (Playwright, production build) | **12 / 12 pass** — typed flow, handwritten flow with uncertain-line confirmation, rewrite, hint ladder, progress, admin approve + schedule, rubric activation refusal, auth required, P1 403, cross-student isolation (404), cross-site POST blocked, cookie flags + security headers, renamed-executable upload rejected, non-admin blocked, mobile no-overflow |
| `npm audit` | 0 known vulnerabilities at build time |

## Benchmark (rule-based evaluator; `benchmarks/reports/`)

| Suite | Status | Result |
|---|---|---|
| consistency | PASS* | SD 0.00. *Trivial for a deterministic judge; meaningful only for the AI judge* |
| invariance | PASS | max Δ 0.00 over 8 cases |
| sensitivity | **FAIL** | **88%** (target 90%). One miss is debatable: that answer's conclusion restates the removed part. The other is a real miss: removing one conclusion was not penalised |
| factual_accuracy | PASS | 6/6 planted checkable errors detected with a citation; 0/8 false corrections. *Only facts covered by the corpus's pattern checks* |
| injection | PASS | 24/24 |
| evidence_validity | PASS | 354/354 exact quotes |
| citation_structure | PASS | 6/6 |
| p2_no_answer_writing | PASS | 0 of 294 suggestions flagged |
| strict_validator | PASS | 0 violations in 94 runs |
| genericity | info | mean cross-answer similarity 0.12; 81% of anchored comments quote the student |
| expert_agreement | **NOT MEASURED** | 0 human-reviewed cases |
| citation_support, style_neutrality | **NOT MEASURED** | need human review |
| ocr_silent_guess | info | harness verified on a synthetic fixture only |

**The AI evaluator has not been benchmarked against the live API.** No key was available during the build. Its code path is covered by mock-provider tests: median aggregation, quote and citation repair, sample failure, banned-phrase stripping and suggestion trimming.

## Security notes

- Every student-content read goes through ownership checks in the service layer. Reviewer access to uploads and answers is written to `audit_log`.
- Uploads are stored outside `public/` under random keys with 0600 permissions. They are served only with a valid 5-minute HMAC signature *and* an owner session.
- Images are re-encoded, which strips EXIF/GPS and appended payloads. PDFs are refused if they contain JavaScript, embedded files, launch actions, XFA or encryption.
- CSRF: SameSite=Lax cookies plus Origin / `Sec-Fetch-Site` checks on mutating requests.
- No answer text is logged. Errors return generic messages.

## Unverified facts introduced

- UPSC GS paper format (250 marks, 180 min, ~150/~250 words) — checked against a secondary source.
- RBI Grade B Phase II pattern — secondary source while the 2025 notification was awaited.
- Seed corpus text: constitutional articles reproduced verbatim from memory; all others are MarkMyWords summaries. The inflation-target note (4% ±2% for 2021–26) is flagged "check current notification".
- Official links point to homepages; deep links must be added during source verification.

## Unresolved risks and open questions

1. **Expert calibration** — recruit at least 2 qualified evaluators to grade 50–100 answers per paper. Measure human–human agreement first.
2. **Live AI evaluation** — run `npm run bench -- --provider anthropic` with a budget. Confirm the model IDs and current prices (`MMW_PRICE_*` are placeholders).
3. **Rule-based judge limitations** — it is lexical: it can be gamed by keywords and misjudges synonyms. It is labelled as a demo everywhere.
4. **OCR on real Indian handwriting** — measure character error rate and silent-guess rate on a consented sample set.
5. **Scale** — single-node SQLite and an in-process job queue. Move to Postgres (with RLS) and a separate worker before multi-instance deployment.
6. **Copyright** — keep editorials link-only. The seed corpus contains only constitutional text and MarkMyWords summaries.
7. **DPDP Act 2023 and minors** — requires a legal review before public launch.
8. **Next.js file-tracing warning** — config files are read at runtime. This is harmless for `next start`, but `outputFileTracingIncludes` is needed if switching to `output: "standalone"`.

## Demo script

1. Run `npm install && npm run setup && npm run build && npm start`, then open http://localhost:3000.
2. Sign up. Today shows the question of the day, with its reasons for priority.
3. Open it, choose **Typed**, write ~150 words including the line "GST was rolled out in 2016", then submit.
4. Do the self-check, then **Save & get feedback**. You'll see the score stamp with its range and disclaimer, top priorities, the annotated answer (click a red underline), a cited fact check and the self-check gap.
5. Open hint rungs 0 → 3, then **Rewrite it myself**, fix the flagged lines and submit. **What changed** shows resolved and unresolved items.
6. Go to Progress for the skill profile, error ledger, charts and transfer checks scheduled +48h.
7. For an admin: add your email to `MMW_ADMIN_EMAILS` and log in → **Review desk**. Approve questions, schedule the question of the day, resolve disputes, verify sources, view costs and the audit log.
