import path from "node:path";

function int(v: string | undefined, d: number): number {
  const n = v === undefined || v === "" ? NaN : Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : d;
}
function num(v: string | undefined, d: number): number {
  const n = v === undefined || v === "" ? NaN : Number(v);
  return Number.isFinite(n) ? n : d;
}

export type ProviderName = "anthropic" | "gemini" | "heuristic" | "mock";
export type OcrProviderName = "anthropic" | "gemini" | "mock" | "manual";

/** Find an env var by any of several names, case-insensitively (Vercel keeps the casing you type). */
function envAny(...names: string[]): string | undefined {
  for (const n of names) if (process.env[n]) return process.env[n];
  const wanted = new Set(names.map((n) => n.toLowerCase()));
  for (const [k, v] of Object.entries(process.env)) if (v && wanted.has(k.toLowerCase())) return v;
  return undefined;
}

/**
 * Hosted libSQL/Turso connection. The Vercel Marketplace integration sets TURSO_DATABASE_URL and
 * TURSO_AUTH_TOKEN, possibly with a custom prefix (e.g. STORAGE_TURSO_DATABASE_URL); accept those too.
 */
function tursoFromEnv(): { url: string; token?: string } | null {
  const direct = envAny("TURSO_DATABASE_URL", "LIBSQL_URL", "MMW_DATABASE_URL");
  const directToken = envAny("TURSO_AUTH_TOKEN", "LIBSQL_AUTH_TOKEN", "MMW_DATABASE_AUTH_TOKEN");
  if (direct) return { url: direct.trim(), token: directToken?.trim() };
  for (const [k, v] of Object.entries(process.env)) {
    if (!v || !/TURSO_DATABASE_URL$/i.test(k)) continue;
    const prefix = k.slice(0, k.length - "TURSO_DATABASE_URL".length);
    const token = process.env[`${prefix}TURSO_AUTH_TOKEN`] ?? envAny(`${prefix}TURSO_AUTH_TOKEN`);
    return { url: v.trim(), token: token?.trim() };
  }
  return null;
}

/** MMW_SIGNING_SECRET if it was actually set (the .env.example placeholder does not count). */
export function configuredSigningSecret(): string | undefined {
  const v = process.env.MMW_SIGNING_SECRET?.trim();
  return v && v !== "change-me" && v.length >= 16 ? v : undefined;
}

/** Read configuration at call time so tests can override process.env. */
export function getEnv() {
  const cwd = process.cwd();
  const anthropicKey = process.env.ANTHROPIC_API_KEY?.trim() || undefined;
  const geminiKey = envAny("GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY")?.trim() || undefined;
  const providerEnv = (process.env.MMW_PROVIDER || "").toLowerCase();
  const provider: ProviderName =
    providerEnv === "anthropic" || providerEnv === "gemini" || providerEnv === "heuristic" || providerEnv === "mock"
      ? providerEnv
      : anthropicKey
        ? "anthropic"
        : geminiKey
          ? "gemini"
          : "heuristic";
  const ocrEnv = (process.env.MMW_OCR_PROVIDER || "").toLowerCase();
  const ocrProvider: OcrProviderName =
    ocrEnv === "anthropic" || ocrEnv === "gemini" || ocrEnv === "mock" || ocrEnv === "manual"
      ? ocrEnv
      : provider === "anthropic" || provider === "gemini"
        ? provider
        : anthropicKey
          ? "anthropic"
          : geminiKey
            ? "gemini"
            : "manual";
  // Model IDs are provider-specific; ignore an override meant for the other provider.
  const pick = (v: string | undefined, forGemini: boolean, dflt: string) => (v && /^gemini/i.test(v) === forGemini ? v : dflt);
  const gem = (p: string) => p === "gemini";
  const isProd = process.env.NODE_ENV === "production";
  const onVercel = !!process.env.VERCEL;
  // Hosted libSQL (Turso). The Vercel Marketplace integration sets TURSO_DATABASE_URL / TURSO_AUTH_TOKEN.
  const turso = tursoFromEnv();
  const remoteUrl = turso?.url ?? "";
  const remoteToken = turso?.token || undefined;
  // Without a hosted DB on a serverless platform, fall back to /tmp (works, but resets with the instance).
  const localPath = process.env.MMW_DB_PATH || (onVercel ? "/tmp/markmywords.db" : path.join(cwd, "data", "markmywords.db"));
  return {
    isProd,
    isTest: process.env.NODE_ENV === "test" || process.env.VITEST === "true",
    onVercel,
    dbUrl: remoteUrl || localPath,
    dbAuthToken: remoteUrl ? remoteToken : undefined,
    /** True when data lives somewhere that can disappear (serverless /tmp). Shown as a banner. */
    ephemeralStorage: !remoteUrl && onVercel,
    configDir: process.env.MMW_CONFIG_DIR || path.join(cwd, "config"),
    contentDir: process.env.MMW_CONTENT_DIR || path.join(cwd, "content"),
    migrationsDir: path.join(cwd, "migrations"),
    signingSecret: configuredSigningSecret() || (globalThis as { __mmwSecret?: string }).__mmwSecret || "dev-only-insecure-signing-secret-change-me",
    anthropicKey,
    anthropicBaseUrl: process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com",
    provider,
    ocrProvider,
    allowMock: process.env.MMW_ALLOW_MOCK === "true" || !isProd,
    geminiKey,
    geminiBaseUrl: process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com",
    /** Tried in order when the chosen Gemini model is unknown or out of quota. */
    geminiFallbackModels: (process.env.MMW_GEMINI_FALLBACK_MODELS || "gemini-3.6-flash,gemini-3.5-flash-lite,gemini-flash-latest")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    judgeModel: pick(process.env.MMW_JUDGE_MODEL, gem(provider), gem(provider) ? "gemini-3.8-flash" : "claude-sonnet-5-5"),
    fastModel: pick(process.env.MMW_FAST_MODEL, gem(provider), gem(provider) ? "gemini-3.5-flash-lite" : "claude-haiku-5-5"),
    visionModel: pick(process.env.MMW_VISION_MODEL || process.env.MMW_JUDGE_MODEL, gem(ocrProvider), gem(ocrProvider) ? "gemini-3.8-flash" : "claude-sonnet-5-5"),
    evalSamples: Math.min(5, Math.max(1, int(process.env.MMW_EVAL_SAMPLES, 3))),
    // Placeholder Gemini prices (INR per million tokens); set from Google's current price list.
    geminiPriceInputPerMTokInr: num(process.env.MMW_GEMINI_PRICE_INPUT_PER_MTOK_INR, 70),
    geminiPriceOutputPerMTokInr: num(process.env.MMW_GEMINI_PRICE_OUTPUT_PER_MTOK_INR, 340),
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
    // Vercel functions accept request bodies up to 4.5 MB; the browser downsizes photos before upload.
    maxImageBytes: int(process.env.MMW_MAX_IMAGE_BYTES, onVercel ? 4 * 1024 * 1024 : 10 * 1024 * 1024),
    maxPdfBytes: int(process.env.MMW_MAX_PDF_BYTES, onVercel ? 4 * 1024 * 1024 : 25 * 1024 * 1024),
    maxPagesPerAttempt: int(process.env.MMW_MAX_PAGES, 12),
    signupsPerIpPerHour: int(process.env.MMW_SIGNUPS_PER_IP_PER_HOUR, 10),
    /** Time budget per background job; must stay below the platform's function limit (300 s here). */
    jobBudgetMs: int(process.env.MMW_JOB_BUDGET_MS, onVercel ? 230_000 : 600_000),
  };
}

export type Env = ReturnType<typeof getEnv>;
