import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const tscPath = fileURLToPath(
  new URL("./node_modules/typescript/bin/tsc", import.meta.url)
);

const initialBuild = spawnSync(process.execPath, [tscPath], {
  stdio: "inherit",
});

if (initialBuild.status !== 0) {
  process.exit(initialBuild.status ?? 1);
}

const compiler = spawn(
  process.execPath,
  [tscPath, "--watch", "--preserveWatchOutput"],
  { stdio: "inherit" }
);
const server = spawn(process.execPath, ["--watch", "dist/index.js"], {
  stdio: "inherit",
});

let shuttingDown = false;

function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  compiler.kill();
  server.kill();
  process.exit(exitCode);
}

compiler.on("exit", (code) => {
  if (!shuttingDown && code !== 0) shutdown(code ?? 1);
});
server.on("exit", (code) => {
  if (!shuttingDown && code !== 0) shutdown(code ?? 1);
});

process.on("SIGINT", () => shutdown());
process.on("SIGTERM", () => shutdown());
