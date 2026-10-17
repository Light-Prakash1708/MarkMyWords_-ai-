import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadDirectives, loadExamConfigs, loadQuestionFiles, loadRubricTemplates, loadSkills, loadSourceFiles } from "@/lib/exam-config";
import { tempDir } from "../helpers";

describe("exam configuration", () => {
  it("loads and validates all exam configs", () => {
    const cfgs = loadExamConfigs();
    expect(cfgs.length).toBeGreaterThanOrEqual(2);
    for (const c of cfgs) {
      for (const p of c.papers) {
        expect(p.fact_source_url).toMatch(/^https:\/\//);
        expect(["official", "secondary", "unverified"]).toContain(p.verification_status);
      }
    }
  });
  it("keeps the second exam out of full launch (preview or inactive) until it has a calibrated rubric", () => {
    const notLive = loadExamConfigs().filter((c) => c.exam.status === "inactive" || c.exam.stage === "preview");
    expect(notLive.length).toBeGreaterThanOrEqual(1);
    for (const c of notLive) expect(c.exam.input_modes).toEqual(["typed"]);
  });
  it("every active paper has questions and a rubric for each of its question types", () => {
    const qs = loadQuestionFiles();
    const rubrics = loadRubricTemplates();
    for (const c of loadExamConfigs()) {
      if (c.exam.status !== "active") continue;
      for (const p of c.papers.filter((x) => x.status === "active")) {
        expect(qs.some((f) => f.paper_code === p.code && f.questions.length >= 3)).toBe(true);
        for (const qt of p.question_types) expect(rubrics.some((r) => r.exam_code === c.exam.code && r.question_type_codes.includes(qt.code))).toBe(true);
      }
    }
  });
  it("rejects an invalid exam config", async () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, "bad.yaml"), "exam:\n  code: bad code\n");
    await expect((async () => loadExamConfigs(dir))()).rejects.toThrow(/Invalid exam config/);
  });
  it("rubric weights sum to 1 and every criterion has max_band+1 bands", () => {
    for (const r of loadRubricTemplates()) {
      expect(r.criteria.reduce((s, c) => s + c.weight, 0)).toBeCloseTo(1, 6);
      for (const c of r.criteria) expect(c.bands.length).toBe(r.max_band + 1);
      expect(r.status).not.toBe("active");
    }
  });
  it("questions reference known directives and skills", () => {
    const d = new Set(loadDirectives().map((x) => x.code));
    const s = new Set(loadSkills().map((x) => x.code));
    for (const f of loadQuestionFiles()) for (const q of f.questions) {
      q.directive_codes.forEach((c) => expect(d.has(c)).toBe(true));
      q.skill_tags_targeted.forEach((c) => expect(s.has(c)).toBe(true));
      expect(q.parts.length).toBeGreaterThan(0);
    }
  });
  it("every heuristic fact-check quote is a substring of its source", () => {
    for (const f of loadSourceFiles()) for (const s of f.sources) for (const c of s.heuristic_checks) {
      expect(s.chunks.some((ch) => ch.includes(c.quote))).toBe(true);
    }
  });
});
