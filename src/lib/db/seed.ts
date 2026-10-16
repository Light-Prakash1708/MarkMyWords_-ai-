import type { DB } from "./index";
import { toJson } from "./json";
import {
  loadDirectives,
  loadExamConfigs,
  loadQuestionFiles,
  loadRubricTemplates,
  loadSkills,
  loadSourceFiles,
} from "../exam-config";
import { newId, nowIso, randomToken, sha256Hex } from "../util/ids";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { configuredSigningSecret, getEnv } from "../env";

/**
 * Idempotent sync of config + content into the database.
 * - Exam/paper/question-type/syllabus config is upserted (config is the source of truth).
 * - Rubric versions are INSERT-ONLY. If an existing version's content changed, sync fails loudly:
 *   active rubric versions are immutable — bump the version instead.
 * - Questions and sources are inserted when new; existing rows are left alone so reviewer edits
 *   and review status are preserved.
 */
export async function ensureSeeded(db: DB): Promise<void> {
  const hash = contentHash();
  const meta = (await db.get("SELECT value FROM app_meta WHERE key = 'content_hash'")) as { value: string } | undefined;
  if (meta?.value !== hash) {
    const t = nowIso();
    await db.transaction(async (db) => {
      await syncExams(db, t);
      await syncDirectivesAndSkills(db);
      await syncRubrics(db, t);
      await syncSources(db, t);
      await syncQuestions(db, t);
      await db.run(
        "INSERT INTO app_meta (key, value, updated_at) VALUES ('content_hash', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        hash, t,
      );
    });
  }
  await ensureSigningSecret(db);
}

/** Hash of every config/content file, so a warm (or freshly started) server skips the sync when nothing changed. */
function contentHash(): string {
  const env = getEnv();
  const files: string[] = [];
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else files.push(p);
    }
  };
  walk(env.configDir);
  walk(env.contentDir);
  const h = createHash("sha256");
  for (const f of files.sort()) h.update(path.relative(process.cwd(), f)).update(fs.readFileSync(f));
  return h.digest("hex");
}

/** Signed upload URLs need a stable secret across serverless instances: use the env var, else one stored in the DB. */
async function ensureSigningSecret(db: DB) {
  if (configuredSigningSecret()) return;
  let row = (await db.get("SELECT value FROM app_meta WHERE key = 'signing_secret'")) as { value: string } | undefined;
  if (!row) {
    await db.run("INSERT OR IGNORE INTO app_meta (key, value, updated_at) VALUES ('signing_secret', ?, ?)", randomToken(32), nowIso());
    row = (await db.get("SELECT value FROM app_meta WHERE key = 'signing_secret'")) as { value: string };
  }
  (globalThis as { __mmwSecret?: string }).__mmwSecret = row.value;
}

async function syncExams(db: DB, t: string) {
  for (const cfg of loadExamConfigs()) {
    const e = cfg.exam;
    const existing = (await db.get("SELECT id FROM exams WHERE code = ?", e.code)) as { id: string } | undefined;
    const examId = existing?.id ?? newId();
    if (existing) {
      (await db.run("UPDATE exams SET name=?, short_name=?, status=?, config_version=?, input_modes=?, default_input_mode=?, ux=?, updated_at=? WHERE id=?", e.name, e.short_name, e.status, e.config_version, toJson(e.input_modes), e.default_input_mode, toJson(e.ux), t, examId));
    } else {
      (await db.run("INSERT INTO exams (id, code, name, short_name, status, config_version, input_modes, default_input_mode, ux, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)", examId, e.code, e.name, e.short_name, e.status, e.config_version, toJson(e.input_modes), e.default_input_mode, toJson(e.ux), t, t));
    }
    for (const p of cfg.papers) {
      const ep = (await db.get("SELECT id FROM papers WHERE code = ?", p.code)) as { id: string } | undefined;
      const paperId = ep?.id ?? newId();
      const status = e.status === "inactive" ? "inactive" : p.status;
      if (ep) {
        (await db.run("UPDATE papers SET exam_id=?, name=?, subtitle=?, total_marks=?, duration_min=?, default_input_mode=?, fact_source_url=?, official_reference_url=?, verified_on=?, verification_status=?, status=?, updated_at=? WHERE id=?", examId, p.name, p.subtitle ?? null, p.total_marks, p.duration_min, p.default_input_mode, p.fact_source_url, p.official_reference_url ?? null, p.verified_on, p.verification_status, status, t, paperId));
      } else {
        (await db.run("INSERT INTO papers (id, exam_id, code, name, subtitle, total_marks, duration_min, default_input_mode, fact_source_url, official_reference_url, verified_on, verification_status, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", paperId, examId, p.code, p.name, p.subtitle ?? null, p.total_marks, p.duration_min, p.default_input_mode, p.fact_source_url, p.official_reference_url ?? null, p.verified_on, p.verification_status, status, t, t));
      }
      for (const qt of p.question_types) {
        const eq = (await db.get("SELECT id FROM question_types WHERE paper_id = ? AND code = ?", paperId, qt.code)) as { id: string } | undefined;
        if (eq) {
          (await db.run("UPDATE question_types SET marks=?, word_limit=?, time_budget_min=?, word_tolerance_pct=?, updated_at=? WHERE id=?", qt.marks, qt.word_limit, qt.time_budget_min, qt.word_tolerance_pct, t, eq.id));
        } else {
          (await db.run("INSERT INTO question_types (id, paper_id, code, marks, word_limit, time_budget_min, word_tolerance_pct, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)", newId(), paperId, qt.code, qt.marks, qt.word_limit, qt.time_budget_min, qt.word_tolerance_pct, t, t));
        }
      }
      for (const s of p.syllabus) {
        const es = (await db.get("SELECT id FROM syllabus_nodes WHERE code = ?", s.code)) as { id: string } | undefined;
        if (es) {
          (await db.run("UPDATE syllabus_nodes SET title=?, parent_code=?, micro_topics=?, source_url=?, updated_at=? WHERE id=?", s.title, s.parent_code ?? null, toJson(s.micro_topics), p.official_reference_url ?? p.fact_source_url, t, es.id));
        } else {
          (await db.run("INSERT INTO syllabus_nodes (id, paper_id, code, parent_code, title, text_kind, micro_topics, source_url, created_at, updated_at) VALUES (?,?,?,?,?,'paraphrase',?,?,?,?)", newId(), paperId, s.code, s.parent_code ?? null, s.title, toJson(s.micro_topics), p.official_reference_url ?? p.fact_source_url, t, t));
        }
      }
    }
  }
}

async function syncDirectivesAndSkills(db: DB) {
  for (const d of loadDirectives()) {
    await db.run(
      "INSERT INTO directives (code, label, demand, expected_moves) VALUES (?,?,?,?) ON CONFLICT(code) DO UPDATE SET label=excluded.label, demand=excluded.demand, expected_moves=excluded.expected_moves",
      d.code, d.label, d.demand, toJson(d.expected_moves),
    );
  }
  for (const s of loadSkills()) {
    await db.run("INSERT INTO skill_tags (code, name, grp) VALUES (?,?,?) ON CONFLICT(code) DO UPDATE SET name=excluded.name, grp=excluded.grp", s.code, s.name, s.group);
  }
}

async function syncRubrics(db: DB, t: string) {
  const skillCodes = new Set(((await db.all("SELECT code FROM skill_tags")) as { code: string }[]).map((r) => r.code));
  for (const tpl of loadRubricTemplates()) {
    for (const c of tpl.criteria) {
      for (const s of c.skill_tags) if (!skillCodes.has(s)) throw new Error(`Rubric ${tpl.template_code}: unknown skill tag ${s}`);
      if (c.bands.length !== tpl.max_band + 1) throw new Error(`Rubric ${tpl.template_code}.${c.code}: expected ${tpl.max_band + 1} bands`);
    }
    const contentHash = sha256Hex(JSON.stringify({ criteria: tpl.criteria, max_band: tpl.max_band }));
    for (const qt of tpl.question_type_codes) {
      const code = `${tpl.template_code}_${qt}`;
      let rubric = (await db.get("SELECT id FROM rubrics WHERE code = ?", code)) as { id: string } | undefined;
      if (!rubric) {
        rubric = { id: newId() };
        (await db.run("INSERT INTO rubrics (id, code, exam_code, question_type_code, paper_codes, title, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)", rubric.id, code, tpl.exam_code, qt, toJson(tpl.paper_codes), `${tpl.title} (${qt})`, t, t));
      }
      const ver = (await db.get("SELECT id, content_hash FROM rubric_versions WHERE rubric_id = ? AND version = ?", rubric.id, tpl.version)) as
        | { id: string; content_hash: string }
        | undefined;
      if (ver) {
        if (ver.content_hash !== contentHash) {
          throw new Error(
            `Rubric ${code} v${tpl.version} content changed but version did not. Rubric versions are immutable — bump the version.`,
          );
        }
        continue;
      }
      // A template may say "active" only if a calibration report is attached later via activateRubricVersion.
      const status = tpl.status === "active" ? "calibrating" : tpl.status;
      (await db.run("INSERT INTO rubric_versions (id, rubric_id, version, status, criteria, max_band, aggregation, disclaimer, changelog, content_hash, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", newId(), rubric.id, tpl.version, status, toJson(tpl.criteria), tpl.max_band, tpl.aggregation, tpl.disclaimer, tpl.changelog, contentHash, t, t));
    }
  }
}

async function syncSources(db: DB, t: string) {
  for (const file of loadSourceFiles()) {
    for (const s of file.sources) {
      const joined = s.chunks.join("\n");
      for (const chk of s.heuristic_checks) {
        if (!s.chunks.some((c) => c.includes(chk.quote))) {
          throw new Error(`Source ${s.slug}: heuristic check ${chk.id} quote is not a substring of any chunk`);
        }
        new RegExp(chk.claim_pattern, "i");
        new RegExp(chk.expected_pattern);
      }
      const exists = (await db.get("SELECT id FROM sources WHERE slug = ?", s.slug)) as { id: string } | undefined;
      if (exists) {
        // Deterministic fact-check patterns are code-like config: keep them current. Text and
        // verification status are left alone so reviewer verification is preserved.
        (await db.run("UPDATE sources SET heuristic_checks = ? WHERE id = ?", toJson(s.heuristic_checks), exists.id));
        continue;
      }
      const id = newId();
      (await db.run("INSERT INTO sources (id, slug, kind, text_kind, title, publisher, url, published_on, retrieved_on, license, content_hash, verification_status, stale_after_days, heuristic_checks, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,'unverified',?,?,?,?)", id, s.slug, s.kind, s.text_kind, s.title, s.publisher, s.official_url, s.published_on, t.slice(0, 10), s.license, sha256Hex(joined), s.stale_after_days, toJson(s.heuristic_checks), t, t));
      let offset = 0;
      for (const [i, text] of s.chunks.entries()) {
        await db.run("INSERT INTO source_chunks (id, source_id, ordinal, text, char_start, char_end, created_at) VALUES (?,?,?,?,?,?,?)", newId(), id, i, text, offset, offset + text.length, t);
        offset += text.length + 1;
      }
    }
  }
}

async function syncQuestions(db: DB, t: string) {
  const directiveCodes = new Set(((await db.all("SELECT code FROM directives")) as { code: string }[]).map((r) => r.code));
  const skillCodes = new Set(((await db.all("SELECT code FROM skill_tags")) as { code: string }[]).map((r) => r.code));
  for (const file of loadQuestionFiles()) {
    const paper = (await db.get("SELECT id FROM papers WHERE code = ?", file.paper_code)) as { id: string } | undefined;
    if (!paper) throw new Error(`Question file references unknown paper ${file.paper_code}`);
    const syllabus = new Set(
      ((await db.all("SELECT code FROM syllabus_nodes WHERE paper_id = ?", paper.id)) as { code: string }[]).map((r) => r.code),
    );
    for (const q of file.questions) {
      for (const d of q.directive_codes) if (!directiveCodes.has(d)) throw new Error(`${q.slug}: unknown directive ${d}`);
      for (const s of q.skill_tags_targeted) if (!skillCodes.has(s)) throw new Error(`${q.slug}: unknown skill tag ${s}`);
      for (const s of q.syllabus_codes) if (!syllabus.has(s)) throw new Error(`${q.slug}: unknown syllabus node ${s}`);
      const qt = (await db.get("SELECT id FROM question_types WHERE paper_id = ? AND code = ?", paper.id, q.question_type)) as
        | { id: string }
        | undefined;
      if (!qt) throw new Error(`${q.slug}: unknown question type ${q.question_type}`);
      if ((await db.get("SELECT 1 FROM questions WHERE slug = ?", q.slug))) continue;
      const id = newId();
      (await db.run(`INSERT INTO questions (id, slug, paper_id, question_type_id, text, parts, directive_codes, syllabus_codes, dimensions_expected, origin, priority_reasons, skill_tags_targeted, review_status, dossier_policy, created_by, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,'original',?,?,'pending_human',?,'seed',?,?)`, id, q.slug, paper.id, qt.id, q.text, toJson(q.parts), toJson(q.directive_codes), toJson(q.syllabus_codes),
        toJson(q.dimensions_expected), toJson(q.priority_reasons), toJson(q.skill_tags_targeted), q.dossier.reveal_policy, t, t));
      for (const slug of q.dossier.source_slugs) {
        const src = (await db.get("SELECT id FROM sources WHERE slug = ?", slug)) as { id: string } | undefined;
        if (!src) throw new Error(`${q.slug}: unknown source ${slug}`);
        (await db.run("INSERT OR IGNORE INTO question_sources (question_id, source_id, relation) VALUES (?,?,'background')", id, src.id));
      }
    }
  }
}
