import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadExamConfigs } from "@/lib/exam-config";

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}

/** Exam-specific behaviour must come from config, never from code branches on exam/paper codes. */
describe("no exam-code literals in application code", () => {
  it("src/ contains no exam or paper code string literals", () => {
    const codes = loadExamConfigs().flatMap((c) => [c.exam.code, ...c.papers.map((p) => p.code)]);
    const offenders: string[] = [];
    for (const f of walk(path.join(process.cwd(), "src")).filter((f) => /\.(ts|tsx)$/.test(f))) {
      const src = fs.readFileSync(f, "utf8");
      for (const code of codes) {
        if (new RegExp(`["'\`]${code}["'\`]`).test(src)) offenders.push(`${path.relative(process.cwd(), f)}: ${code}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
