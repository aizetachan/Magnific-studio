import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  // Dev proxies forward browser requests to the real upstreams server-side,
  // so the Anthropic API works from the SPA without CORS and the user's API key
  // travels same-origin. Override the targets via .env if your account uses
  // different hosts. In production, replace these with your backend.
  const anthropicTarget = "https://api.anthropic.com";
  const magnificApiTarget = env.VITE_MAGNIFIC_API_TARGET ?? "https://api.magnific.ai";
  const magnificMcpTarget = env.VITE_MAGNIFIC_MCP_TARGET ?? "https://mcp.magnific.com";
  // Director backend (Claude↔MCP orchestration), run with `npm run server`.
  const directorTarget = env.VITE_DIRECTOR_TARGET ?? "http://localhost:8787";

  return {
    plugins: [react()],
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
    server: {
      port: 5173,
      proxy: {
        "/api/anthropic": {
          target: anthropicTarget,
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/api\/anthropic/, ""),
        },
        "/api/magnific": {
          target: magnificApiTarget,
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/api\/magnific/, ""),
        },
        "/api/mcp": {
          target: magnificMcpTarget,
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/api\/mcp/, ""),
        },
        // Director backend keeps its /api/director prefix (matches server routes).
        "/api/director": {
          target: directorTarget,
          changeOrigin: true,
        },
      },
    },
  };
});
