import pino, {
  type Bindings,
  type Logger,
  type LoggerOptions,
} from "pino";

export type AgentHubLogger = Logger;
export type LogBindings = Bindings;

export type LogLevel =
  | "fatal"
  | "error"
  | "warn"
  | "info"
  | "debug"
  | "trace"
  | "silent";

export interface CreateLoggerOptions
  extends Omit<LoggerOptions, "level" | "redact"> {
  bindings?: LogBindings;
  level?: LogLevel;
  redact?: LoggerOptions["redact"];
  useDefaultRedaction?: boolean;
}

export const defaultRedactPaths = [
  "password",
  "pwd",
  "secret",
  "token",
  "accessToken",
  "refreshToken",
  "apiKey",
  "authorization",
  "cookie",
  "headers.authorization",
  "headers.cookie",
] as const;

const defaultLoggerName = "agent-hub";
const defaultRedactCensor = "[Redacted]";

function readEnv(name: string): string | undefined {
  if (typeof process === "undefined") {
    return undefined;
  }

  return process.env[name];
}

function resolveLevel(level: LogLevel | undefined): LogLevel {
  return level ?? (readEnv("LOG_LEVEL") as LogLevel | undefined) ?? "info";
}

function resolveRedaction(
  redact: LoggerOptions["redact"] | undefined,
  useDefaultRedaction: boolean,
): LoggerOptions["redact"] | undefined {
  if (redact !== undefined) {
    return redact;
  }

  if (!useDefaultRedaction) {
    return undefined;
  }

  return {
    censor: defaultRedactCensor,
    paths: [...defaultRedactPaths],
  };
}

export function createLogger(options: CreateLoggerOptions = {}): AgentHubLogger {
  const {
    bindings,
    level,
    name = defaultLoggerName,
    redact,
    serializers,
    useDefaultRedaction = true,
    ...pinoOptions
  } = options;

  const baseLogger = pino({
    ...pinoOptions,
    name,
    level: resolveLevel(level),
    redact: resolveRedaction(redact, useDefaultRedaction),
    serializers: {
      err: pino.stdSerializers.err,
      error: pino.stdSerializers.err,
      ...serializers,
    },
  });

  return bindings === undefined ? baseLogger : baseLogger.child(bindings);
}

export function createChildLogger(
  parent: AgentHubLogger,
  bindings: LogBindings,
): AgentHubLogger {
  return parent.child(bindings);
}

export const logger = createLogger();
