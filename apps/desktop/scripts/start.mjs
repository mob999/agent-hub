import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const electron = require("electron");
const args = new Set(process.argv.slice(2));
const webUrl =
  process.env.TAVRO_DESKTOP_WEB_URL ??
  (args.has("--prod-web") ? "https://tavro-ai.vercel.app" : "http://localhost:5173");

const child = spawn(electron, ["."], {
  cwd: new URL("..", import.meta.url),
  env: {
    ...process.env,
    TAVRO_DESKTOP_WEB_URL: webUrl,
  },
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
