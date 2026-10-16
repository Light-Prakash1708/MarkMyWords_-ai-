import { defineConfig } from "@playwright/test";
import os from "node:os";
import path from "node:path";

const port = Number(process.env.E2E_PORT ?? 3200);
const dataDir = path.join(os.tmpdir(), `mmw-e2e-${Date.now()}`);

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
      MMW_UPLOAD_DIR: path.join(dataDir, "uploads"),
      MMW_PROVIDER: "heuristic",
      MMW_OCR_PROVIDER: "mock",
      MMW_ALLOW_MOCK: "true",
      MMW_INSECURE_COOKIES: "true",
      MMW_ADMIN_EMAILS: "admin@e2e.test",
      MMW_SIGNING_SECRET: "e2e-signing-secret",
      ANTHROPIC_API_KEY: "",
    },
  },
});
