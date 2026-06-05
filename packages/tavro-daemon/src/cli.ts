#!/usr/bin/env node

import { startDaemon } from "@agent-hub/daemon";

const version = "0.1.0";

const usage = `Usage:
  tavro-daemon connect --gateway-url <url> --device-id <id> --token <token> [--workspace-root <path>]
  tavro-daemon --gateway-url <url> --device-id <id> --token <token> [--workspace-root <path>]

Options:
  --gateway-url      Tavro worker gateway URL.
  --device-id        Tavro daemon device id.
  --token            Tavro daemon device token.
  --workspace-root   Local workspace root. Defaults to ~/.agent-hub.
  -h, --help         Show this help message.
  -v, --version      Show the CLI version.
`;

function parseArgs(argv: string[]): Record<string, string | true> {
  const args = argv[0] === "connect" ? argv.slice(1) : argv;
  const parsed: Record<string, string | true> = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "-h" || arg === "--help") {
      parsed.help = true;
      continue;
    }

    if (arg === "-v" || arg === "--version") {
      parsed.version = true;
      continue;
    }

    if (!arg.startsWith("--")) {
      throw new Error(`Unexpected argument: ${arg}`);
    }

    const key = arg.slice(2);
    const value = args[index + 1];

    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Missing value for ${arg}.`);
    }

    parsed[key] = value;
    index += 1;
  }

  return parsed;
}

function getStringArg(
  args: Record<string, string | true>,
  name: string,
): string | undefined {
  const value = args[name];
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help === true) {
    console.log(usage);
    return;
  }

  if (args.version === true) {
    console.log(version);
    return;
  }

  const gatewayUrl = getStringArg(args, "gateway-url");
  const deviceId = getStringArg(args, "device-id");
  const token = getStringArg(args, "token");
  const workspaceRoot = getStringArg(args, "workspace-root");

  if (gatewayUrl === undefined || deviceId === undefined || token === undefined) {
    console.error(usage);
    process.exitCode = 1;
    return;
  }

  process.env.AGENTHUB_DAEMON_GATEWAY_URL = gatewayUrl;
  process.env.AGENTHUB_DEVICE_ID = deviceId;
  process.env.AGENTHUB_DAEMON_TOKEN = token;

  if (workspaceRoot !== undefined) {
    process.env.AGENTHUB_WORKSPACE_ROOT = workspaceRoot;
  }

  await startDaemon();
}

await main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
