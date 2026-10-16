import { expect, test } from "@playwright/test";

test("admin approves a question and schedules it as the question of the day", async ({ page }) => {
  await page.goto("/signup");
  await page.fill("#display_name", "Admin");
  await page.fill("#email", "admin@e2e.test");
  await page.fill("#password", "an e2e admin password");
  await page.click("button[type=submit]");
  await page.waitForURL(/\/today/);
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Humans in the loop" })).toBeVisible();
  const first = page.locator(".card", { hasText: "Pending expert review" }).first();
  const text = (await first.locator("p").first().textContent())!.trim();
  await first.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText("Approved.").first()).toBeVisible();
  await page.goto("/admin?tab=qotd");
  const tomorrow = new Date(Date.now() + 86400_000).toISOString().slice(0, 10);
  await page.getByLabel("Date").fill(tomorrow);
  await page.getByRole("button", { name: "Schedule" }).click();
  await expect(page.getByText("Scheduled.")).toBeVisible();
  await expect(page.locator("li", { hasText: text.slice(0, 40) })).toBeVisible();
  // Rubric activation is refused without a calibration report
  await page.goto("/admin?tab=rubrics");
  await page.getByRole("button", { name: "Activate" }).first().click();
  await expect(page.getByText(/Attach a calibration report/)).toBeVisible();
  // Reviewer reads are audited
  await page.goto("/admin?tab=audit");
  await expect(page.getByText("question_approve")).toBeVisible();
});
