import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { findBanned, stripBanned } from "@/lib/copy/banned";
import { DISCLAIMER, HEURISTIC_NOTICE } from "@/lib/copy/disclaimer";

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}

describe("copy lint (P3 honest scores, P9 no predictions)", () => {
  it("no banned phrase appears in UI or library source", () => {
    const files = walk(path.join(process.cwd(), "src")).filter((f) => /\.(ts|tsx)$/.test(f) && !f.endsWith(path.join("copy", "banned.ts")));
    const hits: string[] = [];
    for (const f of files) {
      const s = fs.readFileSync(f, "utf8");
      for (const h of findBanned(s)) hits.push(`${path.relative(process.cwd(), f)}: "${h}"`);
    }
    expect(hits).toEqual([]);
  });
  it("content files contain no banned phrases", () => {
    const files = walk(path.join(process.cwd(), "content")).filter((f) => f.endsWith(".json"));
    for (const f of files) expect(findBanned(fs.readFileSync(f, "utf8"))).toEqual([]);
  });
  it("disclaimers are clean", () => {
    expect(findBanned(DISCLAIMER.long + DISCLAIMER.short + HEURISTIC_NOTICE)).toEqual([]);
    expect(DISCLAIMER.short.toLowerCase()).toContain("estimate");
  });
  it("detects and strips banned phrases in generated text", () => {
    expect(findBanned("This is your official score.")).toHaveLength(1);
    expect(findBanned("This topic will come in the exam.")).toHaveLength(1);
    expect(findBanned("This is not an official score.")).toHaveLength(0);
    expect(findBanned("MGNREGA is a Rural Employment Guarantee Act.")).toHaveLength(0);
    const r = stripBanned("Good structure. You are guaranteed 12 marks. Add data.");
    expect(r.removed).toBe(1);
    expect(r.text).toBe("Good structure. Add data.");
  });
});
