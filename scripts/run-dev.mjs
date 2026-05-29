#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";

const [, , command, ...args] = process.argv;

if (command === undefined) {
  console.error("Usage: node scripts/run-dev.mjs <command> [...args]");
  process.exit(1);
}

const isWindows = process.platform === "win32";
const child = spawn(command, args, {
  shell: isWindows,
  stdio: "inherit",
  windowsHide: false,
});

let shuttingDown = false;
let requestedSignal = "SIGTERM";

function exitCodeForSignal(signal) {
  return signal === "SIGINT" ? 130 : 143;
}

function killChildTree(signal) {
  if (child.pid === undefined || child.exitCode !== null || child.killed) {
    return;
  }

  if (isWindows) {
    const script = `
$root = ${child.pid}
$all = Get-CimInstance Win32_Process
$childrenByParent = @{}
foreach ($process in $all) {
  $key = [string]$process.ParentProcessId
  if (-not $childrenByParent.ContainsKey($key)) {
    $childrenByParent[$key] = New-Object System.Collections.Generic.List[int]
  }
  $childrenByParent[$key].Add([int]$process.ProcessId)
}
$targets = New-Object System.Collections.Generic.List[int]
function Add-ProcessTree([int]$pid) {
  $key = [string]$pid
  if ($childrenByParent.ContainsKey($key)) {
    foreach ($childPid in $childrenByParent[$key]) {
      Add-ProcessTree $childPid
    }
  }
  if ($pid -ne $PID) {
    $targets.Add($pid)
  }
}
Add-ProcessTree $root
foreach ($targetPid in $targets) {
  Stop-Process -Id $targetPid -Force -ErrorAction SilentlyContinue
}
`;
    spawnSync("powershell.exe", ["-NoProfile", "-Command", script], {
      stdio: "ignore",
      windowsHide: true,
    });
    return;
  }

  child.kill(signal);
}

function requestShutdown(signal) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  requestedSignal = signal;
  killChildTree(signal);

  if (isWindows) {
    process.exit(exitCodeForSignal(signal));
  }

  const timeout = setTimeout(() => {
    process.exit(exitCodeForSignal(signal));
  }, 5000);
  timeout.unref();
}

process.once("SIGINT", () => requestShutdown("SIGINT"));
process.once("SIGTERM", () => requestShutdown("SIGTERM"));

child.once("exit", (code, signal) => {
  if (shuttingDown) {
    process.exit(exitCodeForSignal(requestedSignal));
  }

  if (code !== null) {
    process.exit(code);
  }

  process.exit(signal === null ? 0 : exitCodeForSignal(signal));
});

child.once("error", (error) => {
  console.error(error);
  process.exit(1);
});
