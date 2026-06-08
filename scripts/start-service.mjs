import { spawn } from "node:child_process";

const commands = {
  api: ["pnpm", ["--filter", "@agent-hub/api", "start"]],
  worker: ["pnpm", ["--filter", "@agent-hub/worker", "start"]],
};

const service = process.env.TAVRO_SERVICE;
const command = commands[service];

if (command === undefined) {
  console.error("Set TAVRO_SERVICE to one of: api, worker.");
  process.exit(1);
}

if (
  service === "worker" &&
  process.env.WORKER_PORT === undefined &&
  process.env.PORT !== undefined
) {
  process.env.WORKER_PORT = process.env.PORT;
}

const [bin, args] = command;
const child = spawn(bin, args, {
  stdio: "inherit",
  shell: process.platform === "win32",
});

child.on("exit", (code, signal) => {
  if (signal !== null) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});
