import { expect, test } from "@playwright/test";

const RBI = `Herzberg's two-factor theory separates hygiene factors such as pay and job security from motivators such as recognition, responsibility and growth.

In a public sector bank pay is fixed by industry settlements, so a manager should use motivators: specific and timely recognition, ownership of a product line, structured training and regular feedback. However, hygiene complaints such as workload must also be fixed.

Therefore the bank can raise motivation without large pay increases.`;

test("anyone can try an RBI question without an account and see feedback", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: /Try 3 questions free/ }).click();
  await page.waitForURL(/\/try$/);
  await expect(page.getByRole("heading", { name: /RBI Grade B/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /UPSC CSE/ })).toBeVisible();
  const card = page.locator("article", { hasText: "content theory of motivation" });
  await card.getByRole("button", { name: "Write my answer" }).click();
  await page.waitForURL(/\/attempt\//);
  await expect(page.getByText(/Guest trial/)).toBeVisible();
  await page.fill("#answer", RBI);
  await page.getByRole("button", { name: "Submit answer" }).click();
  await page.getByRole("button", { name: "Yes, submit" }).click();
  await page.getByRole("button", { name: "Skip self-check" }).click();
  await expect(page.getByRole("heading", { name: "Fix these first" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Not official", { exact: true })).toBeVisible();

  // Trial page reflects progress; a non-trial question is blocked for guests.
  await page.goto("/try");
  await expect(page.locator("article", { hasText: "content theory of motivation" }).getByRole("link", { name: /See my feedback/ })).toBeVisible();
  await expect(page.getByLabel(/2 of 3 free answers left/).first()).toBeVisible();
  const blocked = await page.request.post("/api/attempts", { data: { question_id: "gs2-ec-independence", mode: "typed" } });
  expect(blocked.status()).toBe(403);
  expect((await blocked.json()).error.code).toBe("SIGNUP_REQUIRED");

  // Saving the work converts the guest into an account with the same answers.
  await page.getByRole("link", { name: "Save my work" }).first().click();
  await page.fill("#display_name", "Trial User");
  await page.fill("#email", `trial${Date.now()}@example.test`);
  await page.fill("#password", "an e2e test password");
  await page.click("button[type=submit]");
  await page.waitForURL(/\/today/);
  await page.goto("/history");
  await expect(page.getByText(/content theory of motivation/).first()).toBeVisible();
});
