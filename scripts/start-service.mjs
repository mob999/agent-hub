import { spawn } from "node:child_process";

const commands = {
  api: ["pnpm", ["--filter", "@agent-hub/api", "start"]],
  worker: ["pnpm", ["--filter", "@agent-hub/worker", "start"]],
};

const service = process.env.TAVRO_SERVICE;

if (service === "api-worker") {
  startCombinedApiWorker();
} else {
  const command = commands[service];

  if (command === undefined) {
    console.error("Set TAVRO_SERVICE to one of: api, worker, api-worker.");
    process.exit(1);
  }

  if (
    service === "worker" &&
    process.env.WORKER_PORT === undefined &&
    process.env.PORT !== undefined
  ) {
    process.env.WORKER_PORT = process.env.PORT;
  }

  startChild(command, service);
}

function startCombinedApiWorker() {
  const children = new Set();
  let shuttingDown = false;

  const api = startChild(commands.api, "api", {
    onExit: (code, signal) => {
      shutdownFromChild("api", code, signal);
    },
  });
  children.add(api);

  const workerEnv = { ...process.env };
  delete workerEnv.PORT;
  const worker = startChild(commands.worker, "worker", {
    env: workerEnv,
    onExit: (code, signal) => {
      shutdownFromChild("worker", code, signal);
    },
  });
  children.add(worker);

  const shutdown = (signal) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;

    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill(signal);
      }
    }
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  function shutdownFromChild(label, code, signal) {
    children.delete(label === "api" ? api : worker);

    if (!shuttingDown) {
      console.error(`${label} exited; stopping combined service.`);
      shutdown(signal ?? "SIGTERM");
    }

    if (children.size === 0) {
      if (signal !== null && signal !== undefined) {
        process.kill(process.pid, signal);
        return;
      }
      process.exit(code ?? 1);
    }
  }
}

function startChild(command, label, options = {}) {
  const [bin, args] = command;
  const child = spawn(bin, args, {
    env: options.env ?? process.env,
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  child.on("exit", (code, signal) => {
    if (options.onExit !== undefined) {
      options.onExit(code, signal);
      return;
    }

    if (signal !== null) {
      process.kill(process.pid, signal);
      return;
    }

    process.exit(code ?? 1);
  });

  child.on("error", (error) => {
    console.error(`Failed to start ${label}:`, error);
    if (options.onExit !== undefined) {
      options.onExit(1, null);
      return;
    }
    process.exit(1);
  });

  return child;
}
