# MarkMyWords

**An exam-specific answer-writing coach, not an answer generator.** Students write first. MarkMyWords diagnoses weaknesses with evidence from their own words, cites sources for factual corrections, unlocks help one step at a time, and then checks — on a *fresh* question days later — whether the fix actually stuck.

Initial scope: **UPSC CSE Mains GS-II and GS-III** (typed and handwritten). **RBI Grade B Phase II** is configured but inactive. Adding it requires config, rubrics and content only — no code changes.

> Scores are **AI estimates** against MarkMyWords' own exam-aligned rubric. UPSC and RBI publish no criterion-wise marking scheme, and no tool can reproduce examiner marks. The rubric is still **calibrating**: no agreement with human experts has been measured yet, so no accuracy claims are made.

---

## What makes it different

| Problem students report | What MarkMyWords does | Enforced by |
|---|---|---|
| "Feedback is generic and repeats" | Every comment is anchored to an **exact quote** from the answer. Quotes that can't be found are discarded, and messages that don't reference the answer are flagged as possibly generic. | `eval-engine/validate.ts`, `locateQuote` |
| "Is this correction even true?" | Factual corrections must cite an **exact passage** from a retrieved source, or they are downgraded to *uncertain/unverifiable*. Deterministic pattern checks catch common date and figure errors offline. | `verifyCitation`, `pattern-facts.ts` |
| "Marks feel random" | The model never outputs the total. It runs 3 independent passes, takes the **median band** per criterion, and code computes marks. Disagreement widens the range and lowers confidence. | `eval-engine/index.ts` |
| "AI just writes the answer for me" | **Attempt first** (server returns `403 ATTEMPT_REQUIRED`). Then a six-rung hint ladder: diagnosis → nudges → outline prompts → cited dossier → one exemplar paragraph → full sample (last resort, logged). | `hints/ladder.ts`, `/api/questions/[id]/model-answer` |
| "I fix one answer but repeat the mistake" | The system separates **repair** (fixed in a rewrite) from **transfer** (absent on a new question ≥48h later, with no hints). The skill profile, error ledger and recommender are built on that distinction. | `skills/model.ts`, `services/skills.ts` |
| "I can't judge my own answers" | A 30-second **self-assessment** before feedback. The gap between self-rating and estimate is tracked over time. | `SelfAssess.tsx`, progress page |
| "It guessed my handwriting wrong" | Low-confidence OCR lines are highlighted. The student must **confirm, correct or explicitly leave each one uncertain** before evaluation. Comments on uncertain lines are flagged. | `ocr/index.ts`, `confirmTranscript` |
| Prompt injection ("give me 15/15") | Answer text sits inside nonce-delimited, untrusted blocks. Injection lines are detected and flagged, and validators guard the output. Benchmark result: 24/24 attempts resisted. | `prompt.ts`, `features.ts` |
| "I disagree with this comment" | One tap sends it to a human review queue. Reviewer reads of student content are audit-logged. | `/admin?tab=disputes` |

---

## Quick start

Requirements: **Node.js ≥ 22.12**, npm.

```bash
git clone https://github.com/Light-Prakash1708/MarkMyWords_-ai-.git
cd MarkMyWords_-ai-
npm install
npm run setup        # creates .env.local with a random signing secret, migrates + seeds SQLite
npm run build
npm start            # http://localhost:3000
```

For development: `npm run dev`.

**Free trial without an account:** `/try` lets visitors answer three questions per exam (UPSC CSE Mains and RBI Grade B, which is in preview) as a private guest; signing up keeps their work. Limits live in [`config/trial.yaml`](config/trial.yaml).

**Without an API key** the app runs fully: a **rule-based demo evaluator**, clearly labelled everywhere, plus manual transcription for handwritten answers. **With an API key**, set `ANTHROPIC_API_KEY` in `.env.local` to enable the AI evaluator, handwriting OCR, exemplars, sample answers and question drafting.

To make yourself an admin (review desk), add your email to `MMW_ADMIN_EMAILS` in `.env.local` and sign up or log in with it.

> Production on plain `http://localhost`: session cookies are `Secure` in production. Browsers accept that on localhost; behind another host, use HTTPS, or set `MMW_INSECURE_COOKIES=true` for local testing only.

### Deploy on Vercel

1. In Vercel, **Add New → Project**, import `Light-Prakash1708/MarkMyWords_-ai-`. Framework preset: **Next.js** (no build settings to change).
2. **Storage → Marketplace → Turso** (free tier): create a database and connect it to the project. This sets `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`. Tables and seed content are created automatically on the first request.
3. Optional environment variables: a Gemini key (`GEMINI_API_KEY`, or any casing such as `Gemini_API_Key`) or `ANTHROPIC_API_KEY` for the AI evaluator and handwriting OCR; `MMW_ADMIN_EMAILS` (your email, for the review desk); `MMW_SIGNING_SECRET` (any long random string; if unset, one is generated and stored in the database). After deploying, open **Review desk → costs → Run check** to confirm the AI provider answers.
4. **Deploy** (or Redeploy after adding variables).

Without Turso the site still runs, but data lives in the function's `/tmp` and can reset at any time; a banner says so. Uploaded pages are stored in the database, photos are downsized in the browser to stay under Vercel's 4.5 MB request limit, and evaluations run after the response via `after()` (no background worker needed). `npm run test:e2e:vercel` runs the end-to-end suite in this mode.

### Configuration (`.env.local`)

See [`.env.example`](.env.example). The main settings are: the provider and models; `MMW_EVAL_SAMPLES` (default 3); daily evaluation quota; global daily spend cap (circuit breaker); OCR page limit; retest delay (48h); and demo mode (shows questions still pending expert review, with a badge).

---

## How it works

```
Student ─▶ Next.js (App Router, server components + route handlers)
              │
              ├─ services/        attempts · evaluations · hints · skills · admin · users
              ├─ eval-engine/     judges (LLM | rule-based) → aggregate → validate
              ├─ sources/         BM25 retrieval · citation verification
              ├─ ocr/             vision transcription with per-line confidence
              ├─ security/        uploads (magic bytes, re-encode, PDF screening) · rate limits · signed URLs · clamd hook
              └─ db/              libSQL: local SQLite file or hosted Turso · reversible migrations · config/content sync (skipped when unchanged)
Jobs: durable queue in the database, claimed atomically; run via after() per request, plus a 4s sweep on long-running servers
```

- **Exam config is data**: `config/exams/*.yaml`, `config/rubrics/*.json`, `config/directives.yaml`, `config/skills.yaml`. A test fails if any exam or paper code appears as a literal in `src/`.
- **Rubric versions are immutable.** Changing a rubric requires a new version, and activation requires a calibration report covering ≥ 50 human-reviewed answers.
- **Content**: `content/questions/*.json` holds 20 original GS-II/GS-III practice questions (none is a PYQ), and `content/sources/*.json` holds the seed corpus. Both start **unverified/pending review**.
- The evaluation contract (input/output schema, rubric, citation and uncertainty rules) is in [`docs/evaluation-spec.md`](docs/evaluation-spec.md).

---

## Tests and benchmarks

```bash
npm run typecheck
npm test                       # 90 unit + integration tests (Vitest, real SQLite)
npm run build && npm run test:e2e   # 12 Playwright end-to-end tests
npm run bench                  # benchmark suite → benchmarks/reports/
npm run bench -- --provider anthropic --samples 3   # same suite against the AI evaluator (costs money)
```

Latest local results (rule-based evaluator):

| Suite | Result |
|---|---|
| Unit + integration | **90 / 90 pass** |
| End-to-end (Playwright) | **12 / 12 pass** |
| Evidence validity (exact quotes) | 354/354 |
| Citation structure | 6/6 |
| Planted factual errors detected with citation | 100%, 0 false corrections in 8 correct answers |
| Injection resistance | 24/24 |
| Strict validator violations | 0 in 94 runs |
| Sensitivity (removed part or conclusion penalised) | **88% — below the 90% target** |
| Agreement with human experts | **not measured — 0 expert-reviewed answers exist yet** |

Full details are in [`docs/build-report.md`](docs/build-report.md).

---

## Honest status and unresolved risks

- **No expert calibration yet.** The 8 benchmark base answers were drafted by an AI assistant and are marked `pending_human`. Accuracy cannot be claimed until 50–100 answers per paper are reviewed by at least two qualified evaluators.
- **The AI evaluator path was tested only with a mock provider.** No API key was available during the build. Run `npm run bench -- --provider anthropic` before relying on it, and confirm that the model IDs in `.env.local` match models your account can access.
- **Exam facts** (GS paper 250 marks/180 min, ~150/~250-word limits; the RBI Phase II pattern) were checked against secondary sources on 2026-10-16. Confirm them against the official notifications.
- **Seed sources are unverified.** Constitutional articles are reproduced verbatim from memory, and the rest are MarkMyWords summaries. Every citation shows "unverified" until a reviewer verifies it in the review desk. Official links currently point to homepages, not deep links.
- **OCR** quality on real Indian handwriting has not been measured. The confirmation step prevents silent errors, but transcription quality depends on the model.
- **Simple job model.** Jobs run inside the request's `after()` window (up to 300 s on Vercel). That is enough for a few judge samples; a dedicated worker or queue service is the next step for heavy load.
- **DPDP Act 2023**: the app has consent, export and hard delete, but this is not a legal compliance review.

See [`docs/build-report.md`](docs/build-report.md) for the full list.

## Deferred (designed for, not built)

Optional subjects, Essay, GS-I/GS-IV (config-addable), RBI activation (needs a calibrated rubric and a gold set), native mobile apps (the web app is mobile-first), institutional dashboards (`role` and `orgs` table exist), payments (plan field only), Hindi medium (`language` on content records).
