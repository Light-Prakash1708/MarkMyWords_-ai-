import { expect, test } from "@playwright/test";
import { CONTRAST_JS, type LowContrast } from "./contrast";

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`${colorScheme} theme`, () => {
    test.use({ colorScheme });
    test(`public pages have readable text (${colorScheme})`, async ({ page }) => {
      for (const p of ["/", "/try", "/login", "/signup", "/how-we-evaluate"]) {
        await page.goto(p);
        await page.waitForTimeout(700); // let entrance animations finish
        const bad = (await page.evaluate(CONTRAST_JS)) as LowContrast[];
        expect(bad, `${p}: ${JSON.stringify(bad.slice(0, 5))}`).toEqual([]);
      }
    });
  });
}
