/**
 * Runtime configuration, read from Vite env vars (with safe defaults).
 *
 * Goal: a fresh `git clone && npm install && npm run dev` works out of the box
 * with generation simulated, and connecting real APIs is a matter of filling in
 * Settings (in-session) and/or a `.env.local` (auto-loaded) — no code changes.
 *
 * Transports default to the dev-server proxy paths (`/api/*`), which forward to
 * the real upstreams server-side (see vite.config.ts). That avoids browser CORS
 * for the Anthropic API and keeps secrets out of cross-origin requests.
 */

const env = import.meta.env;

function flag(v: string | undefined): boolean {
  return v === "true" || v === "1";
}

export const config = {
  /**
   * Anthropic Messages API base. In dev the Vite proxy (`/api/anthropic`)
   * avoids CORS; in production there is no proxy, so the browser calls
   * Anthropic directly (the direct-browser-access header is always sent and
   * the user's key never touches our server).
   */
  anthropicBase:
    env.VITE_ANTHROPIC_BASE ??
    (import.meta.env.PROD ? "https://api.anthropic.com" : "/api/anthropic"),
  /** Magnific REST API base. Proxy path by default. */
  magnificApiBase: env.VITE_MAGNIFIC_API_BASE ?? "/api/magnific",
  /** Magnific MCP base. Proxy path by default. */
  magnificMcpBase: env.VITE_MAGNIFIC_MCP_BASE ?? "/api/mcp",
  /** Director backend base (Claude↔MCP orchestration). Proxy path by default. */
  directorBase: env.VITE_DIRECTOR_BASE ?? "/api/director",
  /** Path appended to the API base to start a generation job. */
  magnificGeneratePath: env.VITE_MAGNIFIC_GENERATE_PATH ?? "/v1/generations",
  /** When false (default) generation is simulated; when true, real calls run. */
  magnificLive: flag(env.VITE_MAGNIFIC_LIVE),
  /**
   * Estimated € per Magnific credit, to translate credit usage into money.
   * Based on the plan rate (€16/mes = 20 000 créditos → €0.0008/crédito).
   * Override with VITE_MAGNIFIC_CREDIT_EUR if the plan changes.
   */
  magnificCreditEur: Number(env.VITE_MAGNIFIC_CREDIT_EUR) || 16 / 20000,

  /** Seed values applied to a new project's Settings (still editable in-app). */
  seed: {
    anthropicApiKey: env.VITE_ANTHROPIC_API_KEY ?? "",
    directorModel: env.VITE_DIRECTOR_MODEL ?? "claude-opus-4-8",
    magnificApiKey: env.VITE_MAGNIFIC_API_KEY ?? "",
    magnificApiConnected:
      (env.VITE_MAGNIFIC_API_KEY ?? "") !== "" ||
      flag(env.VITE_MAGNIFIC_API_CONNECTED),
  },
};

/** True when the Anthropic base points directly at the public API (not a proxy). */
export const anthropicIsDirect = config.anthropicBase.includes(
  "api.anthropic.com",
);
