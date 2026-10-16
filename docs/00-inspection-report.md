# Phase 0 — Repository inspection report (2026-10-16)

## 1. Existing architecture
The repository `Light-Prakash1708/MarkMyWords_-ai-` was **empty**: no commits, files or branches. There was no existing functionality to preserve and no characterisation tests to write.

## 2. Dependencies
None existed. The chosen stack uses pinned versions, and `npm audit` reported **0 known vulnerabilities** at build time. During setup, vulnerable versions of Next 15 (postcss), sharp (libvips/libheif), Vitest 3 (tinypool) and yaml were flagged, and patched versions were chosen instead: Next 16.4.2, sharp 0.35.5, Vitest 5.0.5, yaml 2.9.1.

## 3. Security concerns
None pre-existing. Controls introduced from the start: hashed session tokens, scrypt passwords, service-layer row isolation, signed upload URLs, upload screening, rate limits, CSRF origin checks and a CSP.

## 4. Gaps against BUILD_PROMPT.md
Everything was missing at the start. See [build-report.md](build-report.md) for the final status of every slice and principle.

## 5. Implementation plan and stack decisions (adapted from §5 of the prompt)

| Prompt recommendation | Decision | Why |
|---|---|---|
| pnpm monorepo with packages | Single Next.js app with `src/lib/<module>` boundaries mirroring the packages | One runnable unit for a solo founder; modules can be split into packages later without rewrites |
| PostgreSQL + RLS + pgvector | SQLite (WAL) + FTS5 BM25; isolation enforced in the service layer and tested | Zero-setup local running ("running file"). Postgres + RLS is the scale-up path (see risks) |
| pg-boss queue | Durable SQLite jobs table + in-process sweeper | Same durability semantics on a single node |
| S3-compatible storage | Private local directory, signed short-lived URLs | Same access model; can be swapped for S3 |
| Email OTP / OAuth | Email + password (scrypt) | No email service available; OTP and OAuth remain open items |
| Drizzle ORM | Typed raw SQL via better-sqlite3 | Fewer moving parts; migrations are plain reversible SQL |

## 6. Questions for the owner (answered by defaults)
- *Provider:* Anthropic (Claude) via `ANTHROPIC_API_KEY`. Without it, a labelled rule-based demo evaluator runs.
- *Design direction:* the references supplied in chat (Dhandha School shopfront, neo-brutalist pastel cards, Bear-style red-pen annotation, mono spec labels) were used.
- *Approval gates:* skipped on the owner's instruction. Gate documents were still written.
