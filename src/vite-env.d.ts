/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base for Anthropic Messages API. Default "/api/anthropic" (dev proxy). */
  readonly VITE_ANTHROPIC_BASE?: string;
  /** Optional default Anthropic API key (dev convenience; bundled into client). */
  readonly VITE_ANTHROPIC_API_KEY?: string;
  /** Default director model id. */
  readonly VITE_DIRECTOR_MODEL?: string;

  /** Base for the Magnific REST API. Default "/api/magnific" (dev proxy). */
  readonly VITE_MAGNIFIC_API_BASE?: string;
  /** Upstream target the dev proxy forwards "/api/magnific" to. */
  readonly VITE_MAGNIFIC_API_TARGET?: string;
  /** Base for the Magnific MCP endpoint. Default "/api/mcp" (dev proxy). */
  readonly VITE_MAGNIFIC_MCP_BASE?: string;
  /** Upstream target the dev proxy forwards "/api/mcp" to. */
  readonly VITE_MAGNIFIC_MCP_TARGET?: string;
  /** Optional default Magnific API key (dev convenience). */
  readonly VITE_MAGNIFIC_API_KEY?: string;
  /** "true" to mark the Magnific REST transport connected at startup. */
  readonly VITE_MAGNIFIC_API_CONNECTED?: string;
  /** "true" to enable real Magnific calls; otherwise generation is simulated. */
  readonly VITE_MAGNIFIC_LIVE?: string;
  /** Path appended to the API base to create a generation job. */
  readonly VITE_MAGNIFIC_GENERATE_PATH?: string;

  /** Director backend base (Claude↔MCP orchestration). Default "/api/director". */
  readonly VITE_DIRECTOR_BASE?: string;
  /** Upstream the dev proxy forwards "/api/director" to. */
  readonly VITE_DIRECTOR_TARGET?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
