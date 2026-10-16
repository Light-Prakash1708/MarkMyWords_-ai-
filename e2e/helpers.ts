import { expect, type Page } from "@playwright/test";

let n = 0;
export async function signupFresh(page: Page, name = "E2E Student") {
  n++;
  const email = `e2e${Date.now()}${n}@example.test`;
  await page.goto("/signup");
  await page.fill("#display_name", name);
  await page.fill("#email", email);
  await page.fill("#password", "an e2e test password");
  await page.click("button[type=submit]");
  await page.waitForURL(/\/today/);
  return email;
}

export const ANSWER = `Monetary policy transmission is the process by which changes in the policy repo rate reach lending and deposit rates.

Transmission in India is slow because banks reprice deposits only as they mature, so their cost of funds falls with a lag. Small savings schemes compete with bank deposits, which limits deposit rate cuts. Lending rates stay high.

To improve transmission the RBI introduced the MCLR in 2016 and external benchmark linked lending from October 2019. GST was rolled out in 2016, which also affected prices.

However, existing loans still adjust slowly. Therefore, aligning small savings rates with market rates is the way forward.`;

export async function writeAndEvaluate(page: Page, slug = "gs3-monetary-transmission") {
  await page.goto(`/q/${slug}`);
  await page.locator("label", { hasText: "Typed" }).click();
  await page.getByRole("button", { name: "Start my attempt" }).click();
  await page.waitForURL(/\/attempt\//);
  await page.fill("#answer", ANSWER);
  await page.getByRole("button", { name: "Submit answer" }).click();
  await page.getByRole("button", { name: "Yes, submit" }).click();
  await expect(page.getByText("30-second self-check")).toBeVisible();
  await page.getByRole("button", { name: "Save & get feedback" }).click();
  await expect(page.getByRole("heading", { name: "Fix these first" })).toBeVisible({ timeout: 30_000 });
  return page.url().split("/attempt/")[1];
}
