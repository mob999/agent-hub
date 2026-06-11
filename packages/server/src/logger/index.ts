import pino, {
  type Bindings,
  type DestinationStream,
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
  destination?: DestinationStream;
  level?: LogLevel;
  loki?: {
    basicAuth?: {
      password: string;
      username: string;
    };
    host: string;
    labels?: Record<string, string>;
    tenantId?: string;
  };
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
    destination,
    level,
    loki,
    name = defaultLoggerName,
    redact,
    serializers,
    useDefaultRedaction = true,
    ...pinoOptions
  } = options;

  const loggerOptions = {
    ...pinoOptions,
    name,
    level: resolveLevel(level),
    redact: resolveRedaction(redact, useDefaultRedaction),
    serializers: {
      err: pino.stdSerializers.err,
      error: pino.stdSerializers.err,
      ...serializers,
    },
  };

  const resolvedDestination =
    destination ??
    (loki === undefined
      ? undefined
      : pino.transport({
          targets: [
            {
              target: "pino/file",
              options: { destination: 1 },
            },
            {
              target: "pino-loki",
              options: {
                basicAuth: loki.basicAuth,
                batching: true,
                host: loki.host,
                interval: 5,
                labels: {
                  app: "agent-hub",
                  ...loki.labels,
                },
                propsToLabels: ["lokiLevel"],
                ...(loki.tenantId === undefined
                  ? {}
                  : { headers: { "X-Scope-OrgID": loki.tenantId } }),
              },
            },
          ],
        }));

  const baseLogger = pino(
    {
      ...loggerOptions,
    },
    resolvedDestination,
  );

  return bindings === undefined ? baseLogger : baseLogger.child(bindings);
}

export function createChildLogger(
  parent: AgentHubLogger,
  bindings: LogBindings,
): AgentHubLogger {
  return parent.child(bindings);
}

export const logger = createLogger();
