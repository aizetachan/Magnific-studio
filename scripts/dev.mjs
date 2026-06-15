// One-command dev runner: starts the Director backend AND the Vite dev server
// together, prefixes their logs, and shuts both down on Ctrl-C / when either
// exits. No extra dependencies — just `npm run dev`.

import { spawn } from "node:child_process";

const procs = [];
let down = false;

function prefix(tag, buf) {
  return buf
    .toString()
    .split("\n")
    .map((l) => (l.length ? `${tag} ${l}` : l))
    .join("\n");
}

function start(name, cmd, args) {
  const tag = `[${name}]`;
  const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], env: process.env });
  p.stdout.on("data", (d) => process.stdout.write(prefix(tag, d)));
  p.stderr.on("data", (d) => process.stderr.write(prefix(tag, d)));
  p.on("exit", (code) => {
    if (!down) console.log(`${tag} terminó (código ${code}). Cerrando todo…`);
    shutdown();
  });
  procs.push(p);
}

function shutdown() {
  if (down) return;
  down = true;
  for (const p of procs) {
    try {
      p.kill("SIGTERM");
    } catch {
      /* ignore */
    }
  }
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

const viteBin = `node_modules/.bin/vite${process.platform === "win32" ? ".cmd" : ""}`;

console.log("Magnific Studio — arrancando backend (:8787) + web (:5173)…\n");
start("backend", process.execPath, ["server/index.mjs"]);
start("web", viteBin, []);
