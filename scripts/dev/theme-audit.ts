/**
 * Visual audit: screenshots every main page in light and dark themes, and reports text whose
 * contrast against its effective background is below WCAG AA (4.5:1, or 3:1 for large text).
 *   npx tsx scripts/dev/theme-audit.ts <baseUrl> <outDir> [path ...]
 */
import { chromium, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { CONTRAST_JS } from "../../e2e/contrast";

const base = process.argv[2] ?? "http://localhost:3300";
const out = process.argv[3] ?? "theme-audit";
fs.mkdirSync(out, { recursive: true });



async function audit(page: Page, name: string, theme: string) {
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(out, `${name}-${theme}.png`), fullPage: false });
  const bad = (await page.evaluate(CONTRAST_JS)) as { ratio: number; need: number; tag: string; cls: string; text: string }[];
  for (const b of bad) console.log(`[${theme}] ${name}: ${b.ratio}<${b.need} <${b.tag} class="${b.cls}"> ${b.text}`);
  return bad.length;
}

async function run() {
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined });
  let total = 0;
  const extra = process.argv.slice(4);
  for (const theme of ["light", "dark"] as const) {
    const ctx = await browser.newContext({ colorScheme: theme, viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    for (const p of ["/", "/login", "/signup", "/how-we-evaluate", "/try", ...extra]) {
      const r = await page.goto(base + p);
      if (r && r.status() >= 400) continue;
      total += await audit(page, p === "/" ? "home" : p.replace(/\//g, "_").replace(/^_/, ""), theme);
    }
    // Logged-in pages
    await page.goto(base + "/signup");
    await page.fill("#display_name", "Audit");
    await page.fill("#email", `audit-${theme}-${Date.now()}@example.test`);
    await page.fill("#password", "an audit test password");
    await page.click("button[type=submit]");
    await page.waitForURL(/\/today/);
    for (const p of ["/today", "/practice", "/progress", "/history", "/settings"]) {
      await page.goto(base + p);
      total += await audit(page, p.slice(1), theme);
    }
    // Attempt flow
    const qLink = page.locator("a[href^='/q/']").first();
    await page.goto(base + "/practice");
    const href = await qLink.getAttribute("href");
    if (href) {
      await page.goto(base + href);
      total += await audit(page, "question", theme);
      await page.locator("label", { hasText: "Typed" }).click();
      await page.getByRole("button", { name: "Start my attempt" }).click();
      await page.waitForURL(/\/attempt\//);
      total += await audit(page, "attempt-write", theme);
      await page.fill("#answer", "Monetary policy transmission is the process by which changes in the policy repo rate reach lending and deposit rates.\n\nTransmission in India is slow because banks reprice deposits only as they mature. However, external benchmark lending from October 2019 helped. Therefore, aligning small savings rates with market rates is the way forward.");
      await page.getByRole("button", { name: "Submit answer" }).click();
      await page.getByRole("button", { name: "Yes, submit" }).click();
      await page.getByText("30-second self-check").waitFor();
      total += await audit(page, "attempt-selfcheck", theme);
      await page.getByRole("button", { name: "Save & get feedback" }).click();
      await page.getByRole("heading", { name: "Fix these first" }).waitFor({ timeout: 30_000 });
      total += await audit(page, "attempt-report", theme);
      await page.screenshot({ path: path.join(out, `attempt-report-full-${theme}.png`), fullPage: true });
    }
    await ctx.close();
  }
  await browser.close();
  console.log(`TOTAL low-contrast findings: ${total}`);
}
run().catch((e) => { console.error(e); process.exit(1); });
