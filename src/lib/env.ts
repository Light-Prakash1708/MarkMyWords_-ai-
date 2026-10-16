import path from "node:path";

function int(v: string | undefined, d: number): number {
  const n = v === undefined || v === "" ? NaN : Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : d;
}
function num(v: string | undefined, d: number): number {
  const n = v === undefined || v === "" ? NaN : Number(v);
  return Number.isFinite(n) ? n : d;
}

export type ProviderName = "anthropic" | "heuristic" | "mock";
export type OcrProviderName = "anthropic" | "mock" | "manual";

/** Read configuration at call time so tests can override process.env. */
export function getEnv() {
  const cwd = process.cwd();
  const anthropicKey = process.env.ANTHROPIC_API_KEY || undefined;
  const providerEnv = (process.env.MMW_PROVIDER || "").toLowerCase();
  const provider: ProviderName =
    providerEnv === "anthropic" || providerEnv === "heuristic" || providerEnv === "mock"
      ? providerEnv
      : anthropicKey
        ? "anthropic"
        : "heuristic";
  const ocrEnv = (process.env.MMW_OCR_PROVIDER || "").toLowerCase();
  const ocrProvider: OcrProviderName =
    ocrEnv === "anthropic" || ocrEnv === "mock" || ocrEnv === "manual" ? ocrEnv : anthropicKey ? "anthropic" : "manual";
  const isProd = process.env.NODE_ENV === "production";
  return {
    isProd,
    isTest: process.env.NODE_ENV === "test" || process.env.VITEST === "true",
    dbPath: process.env.MMW_DB_PATH || path.join(cwd, "data", "markmywords.db"),
    uploadDir: process.env.MMW_UPLOAD_DIR || path.join(cwd, "data", "uploads"),
    configDir: process.env.MMW_CONFIG_DIR || path.join(cwd, "config"),
    contentDir: process.env.MMW_CONTENT_DIR || path.join(cwd, "content"),
    migrationsDir: path.join(cwd, "migrations"),
    signingSecret: process.env.MMW_SIGNING_SECRET || "dev-only-insecure-signing-secret-change-me",
    anthropicKey,
    anthropicBaseUrl: process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com",
    provider,
    ocrProvider,
    allowMock: process.env.MMW_ALLOW_MOCK === "true" || !isProd,
    judgeModel: process.env.MMW_JUDGE_MODEL || "claude-sonnet-5-5",
    fastModel: process.env.MMW_FAST_MODEL || "claude-haiku-5-5",
    visionModel: process.env.MMW_VISION_MODEL || process.env.MMW_JUDGE_MODEL || "claude-sonnet-5-5",
    evalSamples: Math.min(5, Math.max(1, int(process.env.MMW_EVAL_SAMPLES, 3))),
    freeEvalsPerDay: int(process.env.MMW_FREE_EVALS_PER_DAY, 10),
    ocrPagesPerDay: int(process.env.MMW_OCR_PAGES_PER_DAY, 30),
    hintCallsPerHour: int(process.env.MMW_HINT_CALLS_PER_HOUR, 40),
    dailySpendCapInr: num(process.env.MMW_DAILY_SPEND_CAP_INR, 500),
    perEvalTokenBudget: int(process.env.MMW_PER_EVAL_TOKEN_BUDGET, 60000),
    // Placeholder prices (INR per million tokens). Set these from your provider's current price list.
    priceInputPerMTokInr: num(process.env.MMW_PRICE_INPUT_PER_MTOK_INR, 300),
    priceOutputPerMTokInr: num(process.env.MMW_PRICE_OUTPUT_PER_MTOK_INR, 1500),
    retestDelayHours: num(process.env.MMW_RETEST_DELAY_HOURS, 48),
    exemplarWaitMinutes: num(process.env.MMW_EXEMPLAR_WAIT_MINUTES, 10),
    adminEmails: (process.env.MMW_ADMIN_EMAILS || "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
    demoMode: process.env.MMW_DEMO_MODE !== "false",
    secureCookies: isProd && process.env.MMW_INSECURE_COOKIES !== "true",
    clamavHost: process.env.MMW_CLAMAV_HOST || undefined,
    clamavPort: int(process.env.MMW_CLAMAV_PORT, 3310),
    maxImageBytes: int(process.env.MMW_MAX_IMAGE_BYTES, 10 * 1024 * 1024),
    maxPdfBytes: int(process.env.MMW_MAX_PDF_BYTES, 25 * 1024 * 1024),
    maxPagesPerAttempt: int(process.env.MMW_MAX_PAGES, 12),
  };
}

export type Env = ReturnType<typeof getEnv>;
