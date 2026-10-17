import { defineConfig } from "@playwright/test";
import os from "node:os";
import path from "node:path";

const port = Number(process.env.E2E_PORT ?? 3200);
const dataDir = path.join(os.tmpdir(), `mmw-e2e-${Date.now()}`);
// E2E_SIMULATE_VERCEL=1 runs the server the way Vercel does: no background sweeper, so every job
// must complete through after(), and the signing secret is bootstrapped from the database.
const simulateVercel = process.env.E2E_SIMULATE_VERCEL === "1";

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${port}`,
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : undefined,
  },
  // Requires a production build first: `npm run build`.
  webServer: {
    command: `npx next start -p ${port}`,
    port,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      MMW_DB_PATH: path.join(dataDir, "e2e.db"),
      MMW_PROVIDER: "heuristic",
      MMW_OCR_PROVIDER: "mock",
      MMW_ALLOW_MOCK: "true",
      MMW_INSECURE_COOKIES: "true",
      MMW_ADMIN_EMAILS: "admin@e2e.test",
      // Every E2E sign-up comes from localhost.
      MMW_SIGNUPS_PER_IP_PER_HOUR: "500",
      ANTHROPIC_API_KEY: "",
      ...(simulateVercel ? { VERCEL: "1", MMW_SIGNING_SECRET: "" } : { MMW_SIGNING_SECRET: "e2e-signing-secret" }),
    },
  },
});
