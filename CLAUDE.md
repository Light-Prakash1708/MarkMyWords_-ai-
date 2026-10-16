# MarkMyWords — notes for coding agents

Read `BUILD_PROMPT.md` (product principles P1–P9) and `docs/evaluation-spec.md` before changing evaluation, hints or scoring.

## Commands
- `npm run setup` — create `.env.local`, migrate + seed SQLite
- `npm run dev` / `npm run build && npm start`
- `npm run typecheck`, `npm test` (Vitest), `npm run test:e2e` (Playwright; needs `npm run build` first; set `PLAYWRIGHT_CHROMIUM_PATH` if browsers are preinstalled elsewhere)
- `npm run bench` — benchmark suite; reports go to `benchmarks/reports/`

## Rules that tests enforce
- Never put exam or paper codes as string literals in `src/` — exam behaviour comes from `config/`.
- Never write banned phrasing (official marks, guarantees, predictions) — see `src/lib/copy/banned.ts`.
- Scores are `score_kind: "ai_estimate"`; score UI must render with the disclaimer.
- The judge never outputs totals; quotes must be located in the transcript; citations must be exact substrings of retrieved chunks.
- Rubric versions are immutable; bump the version in `config/rubrics/*.json` to change criteria.
- Every service function takes `db` and checks ownership (`getOwnedAttempt`); never query student rows without the user id.
- Never mark benchmark cases `human_reviewed` unless a human expert actually reviewed them.

## Layout
`src/lib/{db,exam-config,schemas,eval-engine,llm,ocr,sources,skills,hints,security,services,copy}` · `src/app` (pages + `api/`) · `src/components` · `config/` · `content/` · `migrations/` · `benchmarks/` · `tests/` · `e2e/`
