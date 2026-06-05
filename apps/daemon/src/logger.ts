type LogLevel = "error" | "info" | "warn";

interface LogBindings {
  [key: string]: unknown;
}

export interface DaemonLogger {
  error(bindings: LogBindings, message: string): void;
  info(bindings: LogBindings, message: string): void;
  warn(bindings: LogBindings, message: string): void;
}

function writeLog(
  level: LogLevel,
  baseBindings: LogBindings,
  bindings: LogBindings,
  message: string,
): void {
  const payload = {
    level,
    time: new Date().toISOString(),
    ...baseBindings,
    ...bindings,
    message,
  };
  const line = JSON.stringify(payload);

  if (level === "error") {
    console.error(line);
    return;
  }

  if (level === "warn") {
    console.warn(line);
    return;
  }

  console.info(line);
}

export function createDaemonLogger(input: {
  bindings?: LogBindings;
} = {}): DaemonLogger {
  const baseBindings = input.bindings ?? {};

  return {
    error: (bindings, message) => writeLog("error", baseBindings, bindings, message),
    info: (bindings, message) => writeLog("info", baseBindings, bindings, message),
    warn: (bindings, message) => writeLog("warn", baseBindings, bindings, message),
  };
}
