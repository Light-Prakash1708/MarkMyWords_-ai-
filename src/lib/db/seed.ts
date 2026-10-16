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
import { newId, nowIso, sha256Hex } from "../util/ids";

/**
 * Idempotent sync of config + content into the database.
 * - Exam/paper/question-type/syllabus config is upserted (config is the source of truth).
 * - Rubric versions are INSERT-ONLY. If an existing version's content changed, sync fails loudly:
 *   active rubric versions are immutable — bump the version instead.
 * - Questions and sources are inserted when new; existing rows are left alone so reviewer edits
 *   and review status are preserved.
 */
export function ensureSeeded(db: DB): void {
  const t = nowIso();
  db.transaction(() => {
    syncExams(db, t);
    syncDirectivesAndSkills(db);
    syncRubrics(db, t);
    syncSources(db, t);
    syncQuestions(db, t);
  })();
}

function syncExams(db: DB, t: string) {
  for (const cfg of loadExamConfigs()) {
    const e = cfg.exam;
    const existing = db.prepare("SELECT id FROM exams WHERE code = ?").get(e.code) as { id: string } | undefined;
    const examId = existing?.id ?? newId();
    if (existing) {
      db.prepare(
        "UPDATE exams SET name=?, short_name=?, status=?, config_version=?, input_modes=?, default_input_mode=?, ux=?, updated_at=? WHERE id=?",
      ).run(e.name, e.short_name, e.status, e.config_version, toJson(e.input_modes), e.default_input_mode, toJson(e.ux), t, examId);
    } else {
      db.prepare(
        "INSERT INTO exams (id, code, name, short_name, status, config_version, input_modes, default_input_mode, ux, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      ).run(examId, e.code, e.name, e.short_name, e.status, e.config_version, toJson(e.input_modes), e.default_input_mode, toJson(e.ux), t, t);
    }
    for (const p of cfg.papers) {
      const ep = db.prepare("SELECT id FROM papers WHERE code = ?").get(p.code) as { id: string } | undefined;
      const paperId = ep?.id ?? newId();
      const status = e.status === "inactive" ? "inactive" : p.status;
      if (ep) {
        db.prepare(
          "UPDATE papers SET exam_id=?, name=?, subtitle=?, total_marks=?, duration_min=?, default_input_mode=?, fact_source_url=?, official_reference_url=?, verified_on=?, verification_status=?, status=?, updated_at=? WHERE id=?",
        ).run(examId, p.name, p.subtitle ?? null, p.total_marks, p.duration_min, p.default_input_mode, p.fact_source_url, p.official_reference_url ?? null, p.verified_on, p.verification_status, status, t, paperId);
      } else {
        db.prepare(
          "INSERT INTO papers (id, exam_id, code, name, subtitle, total_marks, duration_min, default_input_mode, fact_source_url, official_reference_url, verified_on, verification_status, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        ).run(paperId, examId, p.code, p.name, p.subtitle ?? null, p.total_marks, p.duration_min, p.default_input_mode, p.fact_source_url, p.official_reference_url ?? null, p.verified_on, p.verification_status, status, t, t);
      }
      for (const qt of p.question_types) {
        const eq = db.prepare("SELECT id FROM question_types WHERE paper_id = ? AND code = ?").get(paperId, qt.code) as { id: string } | undefined;
        if (eq) {
          db.prepare("UPDATE question_types SET marks=?, word_limit=?, time_budget_min=?, word_tolerance_pct=?, updated_at=? WHERE id=?").run(
            qt.marks, qt.word_limit, qt.time_budget_min, qt.word_tolerance_pct, t, eq.id,
          );
        } else {
          db.prepare(
            "INSERT INTO question_types (id, paper_id, code, marks, word_limit, time_budget_min, word_tolerance_pct, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
          ).run(newId(), paperId, qt.code, qt.marks, qt.word_limit, qt.time_budget_min, qt.word_tolerance_pct, t, t);
        }
      }
      for (const s of p.syllabus) {
        const es = db.prepare("SELECT id FROM syllabus_nodes WHERE code = ?").get(s.code) as { id: string } | undefined;
        if (es) {
          db.prepare("UPDATE syllabus_nodes SET title=?, parent_code=?, micro_topics=?, source_url=?, updated_at=? WHERE id=?").run(
            s.title, s.parent_code ?? null, toJson(s.micro_topics), p.official_reference_url ?? p.fact_source_url, t, es.id,
          );
        } else {
          db.prepare(
            "INSERT INTO syllabus_nodes (id, paper_id, code, parent_code, title, text_kind, micro_topics, source_url, created_at, updated_at) VALUES (?,?,?,?,?,'paraphrase',?,?,?,?)",
          ).run(newId(), paperId, s.code, s.parent_code ?? null, s.title, toJson(s.micro_topics), p.official_reference_url ?? p.fact_source_url, t, t);
        }
      }
    }
  }
}

function syncDirectivesAndSkills(db: DB) {
  const up = db.prepare(
    "INSERT INTO directives (code, label, demand, expected_moves) VALUES (?,?,?,?) ON CONFLICT(code) DO UPDATE SET label=excluded.label, demand=excluded.demand, expected_moves=excluded.expected_moves",
  );
  for (const d of loadDirectives()) up.run(d.code, d.label, d.demand, toJson(d.expected_moves));
  const us = db.prepare(
    "INSERT INTO skill_tags (code, name, grp) VALUES (?,?,?) ON CONFLICT(code) DO UPDATE SET name=excluded.name, grp=excluded.grp",
  );
  for (const s of loadSkills()) us.run(s.code, s.name, s.group);
}

function syncRubrics(db: DB, t: string) {
  const skillCodes = new Set((db.prepare("SELECT code FROM skill_tags").all() as { code: string }[]).map((r) => r.code));
  for (const tpl of loadRubricTemplates()) {
    for (const c of tpl.criteria) {
      for (const s of c.skill_tags) if (!skillCodes.has(s)) throw new Error(`Rubric ${tpl.template_code}: unknown skill tag ${s}`);
      if (c.bands.length !== tpl.max_band + 1) throw new Error(`Rubric ${tpl.template_code}.${c.code}: expected ${tpl.max_band + 1} bands`);
    }
    const contentHash = sha256Hex(JSON.stringify({ criteria: tpl.criteria, max_band: tpl.max_band }));
    for (const qt of tpl.question_type_codes) {
      const code = `${tpl.template_code}_${qt}`;
      let rubric = db.prepare("SELECT id FROM rubrics WHERE code = ?").get(code) as { id: string } | undefined;
      if (!rubric) {
        rubric = { id: newId() };
        db.prepare(
          "INSERT INTO rubrics (id, code, exam_code, question_type_code, paper_codes, title, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)",
        ).run(rubric.id, code, tpl.exam_code, qt, toJson(tpl.paper_codes), `${tpl.title} (${qt})`, t, t);
      }
      const ver = db.prepare("SELECT id, content_hash FROM rubric_versions WHERE rubric_id = ? AND version = ?").get(rubric.id, tpl.version) as
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
      db.prepare(
        "INSERT INTO rubric_versions (id, rubric_id, version, status, criteria, max_band, aggregation, disclaimer, changelog, content_hash, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
      ).run(newId(), rubric.id, tpl.version, status, toJson(tpl.criteria), tpl.max_band, tpl.aggregation, tpl.disclaimer, tpl.changelog, contentHash, t, t);
    }
  }
}

function syncSources(db: DB, t: string) {
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
      const exists = db.prepare("SELECT id FROM sources WHERE slug = ?").get(s.slug) as { id: string } | undefined;
      if (exists) {
        // Deterministic fact-check patterns are code-like config: keep them current. Text and
        // verification status are left alone so reviewer verification is preserved.
        db.prepare("UPDATE sources SET heuristic_checks = ? WHERE id = ?").run(toJson(s.heuristic_checks), exists.id);
        continue;
      }
      const id = newId();
      db.prepare(
        "INSERT INTO sources (id, slug, kind, text_kind, title, publisher, url, published_on, retrieved_on, license, content_hash, verification_status, stale_after_days, heuristic_checks, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,'unverified',?,?,?,?)",
      ).run(id, s.slug, s.kind, s.text_kind, s.title, s.publisher, s.official_url, s.published_on, t.slice(0, 10), s.license, sha256Hex(joined), s.stale_after_days, toJson(s.heuristic_checks), t, t);
      let offset = 0;
      s.chunks.forEach((text, i) => {
        const cid = newId();
        db.prepare("INSERT INTO source_chunks (id, source_id, ordinal, text, char_start, char_end, created_at) VALUES (?,?,?,?,?,?,?)").run(
          cid, id, i, text, offset, offset + text.length, t,
        );
        db.prepare("INSERT INTO source_chunks_fts (chunk_id, text) VALUES (?, ?)").run(cid, `${s.title}\n${text}`);
        offset += text.length + 1;
      });
    }
  }
}

function syncQuestions(db: DB, t: string) {
  const directiveCodes = new Set((db.prepare("SELECT code FROM directives").all() as { code: string }[]).map((r) => r.code));
  const skillCodes = new Set((db.prepare("SELECT code FROM skill_tags").all() as { code: string }[]).map((r) => r.code));
  for (const file of loadQuestionFiles()) {
    const paper = db.prepare("SELECT id FROM papers WHERE code = ?").get(file.paper_code) as { id: string } | undefined;
    if (!paper) throw new Error(`Question file references unknown paper ${file.paper_code}`);
    const syllabus = new Set(
      (db.prepare("SELECT code FROM syllabus_nodes WHERE paper_id = ?").all(paper.id) as { code: string }[]).map((r) => r.code),
    );
    for (const q of file.questions) {
      for (const d of q.directive_codes) if (!directiveCodes.has(d)) throw new Error(`${q.slug}: unknown directive ${d}`);
      for (const s of q.skill_tags_targeted) if (!skillCodes.has(s)) throw new Error(`${q.slug}: unknown skill tag ${s}`);
      for (const s of q.syllabus_codes) if (!syllabus.has(s)) throw new Error(`${q.slug}: unknown syllabus node ${s}`);
      const qt = db.prepare("SELECT id FROM question_types WHERE paper_id = ? AND code = ?").get(paper.id, q.question_type) as
        | { id: string }
        | undefined;
      if (!qt) throw new Error(`${q.slug}: unknown question type ${q.question_type}`);
      if (db.prepare("SELECT 1 FROM questions WHERE slug = ?").get(q.slug)) continue;
      const id = newId();
      db.prepare(
        `INSERT INTO questions (id, slug, paper_id, question_type_id, text, parts, directive_codes, syllabus_codes, dimensions_expected, origin, priority_reasons, skill_tags_targeted, review_status, dossier_policy, created_by, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,'original',?,?,'pending_human',?,'seed',?,?)`,
      ).run(
        id, q.slug, paper.id, qt.id, q.text, toJson(q.parts), toJson(q.directive_codes), toJson(q.syllabus_codes),
        toJson(q.dimensions_expected), toJson(q.priority_reasons), toJson(q.skill_tags_targeted), q.dossier.reveal_policy, t, t,
      );
      for (const slug of q.dossier.source_slugs) {
        const src = db.prepare("SELECT id FROM sources WHERE slug = ?").get(slug) as { id: string } | undefined;
        if (!src) throw new Error(`${q.slug}: unknown source ${slug}`);
        db.prepare("INSERT OR IGNORE INTO question_sources (question_id, source_id, relation) VALUES (?,?,'background')").run(id, src.id);
      }
    }
  }
}
