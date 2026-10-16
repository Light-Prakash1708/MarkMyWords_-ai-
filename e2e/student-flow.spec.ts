import { expect, test } from "@playwright/test";
import { signupFresh, writeAndEvaluate } from "./helpers";

test("landing page explains the product honestly", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/marked/i);
  await expect(page.getByText(/not a mark from UPSC, RBI or any examining body/)).toBeVisible();
});

test("typed answer → self-check → evidence-linked report → hint ladder → rewrite", async ({ page }) => {
  await signupFresh(page);
  await expect(page.getByText("Question of the day")).toBeVisible();
  await writeAndEvaluate(page);

  // Honest score reporting
  await expect(page.getByLabel(/AI estimate .* out of 15/)).toBeVisible();
  await expect(page.getByText("Not official", { exact: true })).toBeVisible();
  await expect(page.getByText(/rule based demo evaluator/i).first()).toBeVisible();

  // Evidence: the planted factual error is flagged with a cited source
  await expect(page.getByText(/GST was rolled out on 1 July 2017/).first()).toBeVisible();
  await expect(page.getByText(/Official reference/).first()).toBeVisible();

  // Clicking an annotation activates its margin note
  const mark = page.locator("button.mark").first();
  await mark.click();
  await expect(page.locator(".margin-note.active")).toHaveCount(1);

  // Hint ladder: step 2 locked until 0 and 1 are opened
  const ladder = page.locator("#ladder");
  await ladder.scrollIntoViewIfNeeded();
  await ladder.getByRole("button", { name: "Open" }).first().click();
  await expect(ladder.getByText(/Your top priorities/)).toBeVisible();
  await ladder.getByRole("button", { name: "Open" }).first().click();
  await expect(ladder.locator(".rung.revealed")).toHaveCount(2);

  // Rewrite
  await page.getByRole("button", { name: "Rewrite it myself" }).click();
  await page.waitForURL(/\/attempt\//);
  await expect(page.getByText(/This is a rewrite/)).toBeVisible();
  const text = await page.inputValue("#answer");
  expect(text).toContain("Monetary policy transmission");
  await page.fill("#answer", text.replace("Lending rates stay high.", "Because deposit costs fall slowly, banks keep lending rates high, which delays transmission.").replace("GST was rolled out in 2016, which also affected prices.", ""));
  await page.getByRole("button", { name: "Submit answer" }).click();
  await page.getByRole("button", { name: "Yes, submit" }).click();
  await page.getByRole("button", { name: "Skip self-check" }).click();
  await expect(page.getByText("What changed since your first attempt")).toBeVisible({ timeout: 30_000 });

  // Progress reflects the loop
  await page.goto("/progress");
  await expect(page.getByText(/Repair is good/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Error ledger" })).toBeVisible();
});

test("handwritten answer: upload → uncertain lines must be resolved → report", async ({ page }) => {
  await signupFresh(page);
  await page.goto("/q/gs3-monetary-transmission");
  await page.getByRole("button", { name: "Start my attempt" }).click(); // default mode: on paper
  await page.waitForURL(/\/attempt\//);
  const sharp = (await import("sharp")).default;
  const img = await sharp({ create: { width: 1000, height: 1300, channels: 3, background: "#f3efe4" } })
    .composite([{ input: Buffer.from('<svg width="1000" height="1300"><text x="60" y="140" font-size="40">My answer sheet</text></svg>'), top: 0, left: 0 }])
    .jpeg()
    .toBuffer();
  await page.setInputFiles("input[type=file]", { name: "page1.jpg", mimeType: "image/jpeg", buffer: img });
  await expect(page.locator(".thumb")).toHaveCount(1, { timeout: 20_000 });
  await page.getByRole("button", { name: /Submit 1 page/ }).click();
  await expect(page.getByText("Check what we read")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: /Resolve 1 more line/ })).toBeDisabled();
  await page.getByRole("button", { name: "Leave uncertain" }).click();
  await page.getByRole("button", { name: "Confirm transcript" }).click();
  await page.getByRole("button", { name: "Skip self-check" }).click();
  await expect(page.getByRole("heading", { name: /Your answer, marked/ })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/ocr uncertain spans/i).first()).toBeVisible();
  await expect(page.getByText("Presentation (handwritten)")).toBeVisible();
});

test("mobile layout has no horizontal scroll", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const page = await ctx.newPage();
  for (const url of ["/", "/login", "/how-we-evaluate"]) {
    await page.goto(url);
    await page.evaluate(() => document.fonts.ready);
    const overflow = await page.evaluate(() => {
      const wide = [...document.querySelectorAll("body *")].filter((e) => e.getBoundingClientRect().right > window.innerWidth + 1 && getComputedStyle(e).position !== "fixed");
      if (wide.length) console.log("wide:", wide.slice(0, 5).map((e) => e.className).join(" | "));
      return document.documentElement.scrollWidth - window.innerWidth;
    });
    expect(overflow, url).toBeLessThanOrEqual(1);
  }
  await ctx.close();
});
