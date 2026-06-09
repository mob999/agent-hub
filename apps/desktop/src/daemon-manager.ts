import {
  app,
  type BrowserWindow,
  safeStorage,
  type Session,
} from "electron";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

type DaemonState =
  | "idle"
  | "checking"
  | "missing_runtime"
  | "starting"
  | "running"
  | "stopped"
  | "error";

export interface DesktopDaemonStatus {
  autoStart: boolean;
  deviceId?: string;
  error?: string;
  logs: string[];
  nodeInstallUrl?: string;
  packageName: string;
  state: DaemonState;
  workspaceRoot: string;
}

interface StoredDevice {
  deviceId: string;
  encryptedToken?: string;
  gatewayUrl?: string;
  token?: string;
  userId: string;
  workspaceRoot: string;
}

interface StoreFile {
  autoStart?: boolean;
  devices?: Record<string, StoredDevice>;
  installationId?: string;
}

interface AuthMeResponse {
  user?: {
    id?: unknown;
  };
}

interface BootstrapResponse {
  deviceId: string;
  gatewayUrl: string;
  token: string;
}

interface DesktopDaemonManagerOptions {
  getApiOrigin(): string;
  getMainWindow(): BrowserWindow | null;
  getSession(): Session;
}

const nodeInstallUrl = "https://nodejs.org/";
const maxLogLines = 200;

function commandSpec(command: string, args: string[]): {
  args: string[];
  command: string;
  shell: boolean;
} {
  if (process.platform !== "win32") {
    return { args, command, shell: false };
  }

  const windowsCommand = command === "npm" || command === "npx"
    ? `${command}.cmd`
    : command;
  return {
    args,
    command: windowsCommand,
    shell: command === "npm" || command === "npx",
  };
}

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function safeDeviceName(): string {
  const hostname = os.hostname().trim().replace(/\s+/g, " ");
  const name = hostname.length > 0 ? `Tavro Desktop (${hostname})` : "Tavro Desktop";
  return name.slice(0, 80);
}

function platformName(): "windows" | "posix" {
  return process.platform === "win32" ? "windows" : "posix";
}

function normalizeWorkspaceRoot(value: string): string {
  const trimmed = value.trim();
  const unquoted =
    trimmed.length >= 2 &&
    trimmed.startsWith('"') &&
    trimmed.endsWith('"')
      ? trimmed.slice(1, -1)
      : trimmed;
  return path.resolve(unquoted);
}

function killProcessTree(child: ChildProcessWithoutNullStreams): void {
  if (process.platform === "win32" && child.pid !== undefined) {
    const killer = spawn("taskkill.exe", [
      "/pid",
      String(child.pid),
      "/t",
      "/f",
    ], {
      windowsHide: true,
    });
    killer.once("error", () => {
      child.kill();
    });
    return;
  }

  child.kill();
}

export class DesktopDaemonManager {
  private readonly options: DesktopDaemonManagerOptions;
  private readonly packageName: string;
  private readonly storePath: string;
  private daemonProcess: ChildProcessWithoutNullStreams | null = null;
  private logs: string[] = [];
  private startPromise: Promise<DesktopDaemonStatus> | null = null;
  private status: DesktopDaemonStatus;
  private store: StoreFile | null = null;

  constructor(options: DesktopDaemonManagerOptions) {
    this.options = options;
    this.packageName =
      process.env.TAVRO_DESKTOP_DAEMON_PACKAGE ?? "@tavro-ai/daemon@latest";
    this.storePath = path.join(app.getPath("userData"), "daemon-store.json");
    this.status = {
      autoStart: false,
      logs: this.logs,
      packageName: this.packageName,
      state: "idle",
      workspaceRoot: app.getPath("home"),
    };
  }

  getStatus(): DesktopDaemonStatus {
    return { ...this.status, logs: [...this.logs] };
  }

  async start(): Promise<DesktopDaemonStatus> {
    if (this.startPromise !== null) {
      return this.startPromise;
    }

    this.startPromise = this.startInternal()
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        this.appendLog(message);
        this.setStatus({ error: message, state: "error" });
        return this.getStatus();
      })
      .finally(() => {
        this.startPromise = null;
      });

    return this.startPromise;
  }

  async restart(): Promise<DesktopDaemonStatus> {
    await this.stopProcess();
    return this.start();
  }

  async startAutoStartIfEnabled(): Promise<void> {
    const store = await this.loadStore();
    if (store.autoStart === true) {
      await this.start().catch(() => undefined);
    } else {
      this.setStatus({ autoStart: false });
    }
  }

  async stopForQuit(): Promise<void> {
    await this.stopProcess();
  }

  private async startInternal(): Promise<DesktopDaemonStatus> {
    if (this.daemonProcess !== null) {
      return this.getStatus();
    }

    this.setStatus({ state: "checking", error: undefined });
    const missingRuntime = await this.detectMissingRuntime();
    if (missingRuntime !== null) {
      this.appendLog(`Missing ${missingRuntime}. Install Node.js from ${nodeInstallUrl}`);
      this.setStatus({
        error: `${missingRuntime} was not found on PATH.`,
        nodeInstallUrl,
        state: "missing_runtime",
      });
      return this.getStatus();
    }

    const bootstrap = await this.bootstrapDevice();
    const workspaceRoot = normalizeWorkspaceRoot(bootstrap.workspaceRoot);
    this.setStatus({
      autoStart: true,
      deviceId: bootstrap.deviceId,
      error: undefined,
      state: "starting",
      workspaceRoot,
    });

    const daemonCommand = commandSpec("npx", [
      "-y",
      this.packageName,
      "connect",
      "--gateway-url",
      bootstrap.gatewayUrl,
      "--device-id",
      bootstrap.deviceId,
      "--token",
      bootstrap.token,
      "--workspace-root",
      workspaceRoot,
    ]);
    const child = spawn(daemonCommand.command, daemonCommand.args, {
      cwd: workspaceRoot,
      env: process.env,
      shell: daemonCommand.shell,
      windowsHide: true,
    });

    this.daemonProcess = child;
    this.appendLog(`Starting ${this.packageName} for ${bootstrap.deviceId}`);
    child.stdout.on("data", (chunk: Buffer) => {
      this.appendLog(chunk.toString("utf8").trimEnd());
    });
    child.stderr.on("data", (chunk: Buffer) => {
      this.appendLog(chunk.toString("utf8").trimEnd());
    });
    child.once("spawn", () => {
      this.setStatus({ state: "running" });
    });
    child.once("error", (error) => {
      this.daemonProcess = null;
      this.appendLog(error.message);
      this.setStatus({
        error: error.message,
        state: error.message.includes("ENOENT") ? "missing_runtime" : "error",
      });
    });
    child.once("exit", (code, signal) => {
      this.daemonProcess = null;
      const message = signal
        ? `Daemon process exited by signal ${signal}.`
        : `Daemon process exited with code ${code ?? 0}.`;
      this.appendLog(message);
      this.setStatus({
        error: code && code !== 0 ? message : undefined,
        state: code && code !== 0 ? "error" : "stopped",
      });
    });

    return this.getStatus();
  }

  private async detectMissingRuntime(): Promise<"node" | "npm" | "npx" | null> {
    for (const name of ["node", "npm", "npx"] as const) {
      const ok = await new Promise<boolean>((resolve) => {
        const spec = commandSpec(name, ["--version"]);
        let child: ChildProcessWithoutNullStreams;
        try {
          child = spawn(spec.command, spec.args, {
            shell: spec.shell,
            windowsHide: true,
          });
        } catch {
          resolve(false);
          return;
        }
        const timer = setTimeout(() => {
          child.kill();
          resolve(false);
        }, 5_000);
        child.once("error", () => {
          clearTimeout(timer);
          resolve(false);
        });
        child.once("exit", (code) => {
          clearTimeout(timer);
          resolve(code === 0);
        });
      });

      if (!ok) {
        return name;
      }
    }

    return null;
  }

  private async bootstrapDevice(): Promise<BootstrapResponse & { workspaceRoot: string }> {
    const apiOrigin = this.options.getApiOrigin();
    const auth = await this.requestJson<AuthMeResponse>("/auth/me");
    const userId = typeof auth.user?.id === "string" ? auth.user.id : undefined;
    if (userId === undefined) {
      throw new Error("Desktop daemon bootstrap requires a signed-in user.");
    }

    const store = await this.loadStore();
    const key = `${apiOrigin}|${userId}`;
    const existing = store.devices?.[key];
    const installationId = await this.getInstallationId(store);
    const deviceId =
      existing?.deviceId ??
      `desktop-${process.platform}-${installationId.slice(0, 8)}-${shortHash(userId)}`;
    const workspaceRoot = normalizeWorkspaceRoot(existing?.workspaceRoot ?? app.getPath("home"));
    const response = await this.requestJson<BootstrapResponse>(
      "/daemon/desktop/bootstrap",
      {
        body: JSON.stringify({
          deviceId,
          name: safeDeviceName(),
          platform: platformName(),
        }),
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      },
    );

    await this.saveDevice(key, {
      deviceId: response.deviceId,
      gatewayUrl: response.gatewayUrl,
      token: response.token,
      userId,
      workspaceRoot,
    });

    return {
      ...response,
      workspaceRoot,
    };
  }

  private async requestJson<T>(pathname: string, init: RequestInit = {}): Promise<T> {
    const apiOrigin = this.options.getApiOrigin();
    const url = new URL(pathname, apiOrigin);
    const cookies = await this.options.getSession().cookies.get({ url: apiOrigin });
    const cookieHeader = cookies
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join("; ");
    const response = await fetch(url.toString(), {
      ...init,
      headers: {
        ...(cookieHeader.length > 0 ? { Cookie: cookieHeader } : {}),
        ...init.headers,
      },
    });

    if (!response.ok) {
      throw new Error(`Request ${pathname} failed with HTTP ${response.status}.`);
    }

    return await response.json() as T;
  }

  private async loadStore(): Promise<StoreFile> {
    if (this.store !== null) {
      return this.store;
    }

    try {
      const content = await readFile(this.storePath, "utf8");
      this.store = JSON.parse(content) as StoreFile;
    } catch {
      this.store = {};
    }

    this.setStatus({
      autoStart: this.store.autoStart === true,
    });
    return this.store;
  }

  private async getInstallationId(store: StoreFile): Promise<string> {
    if (typeof store.installationId === "string") {
      return store.installationId;
    }

    store.installationId = randomUUID().replaceAll("-", "");
    await this.writeStore(store);
    return store.installationId;
  }

  private async saveDevice(key: string, device: StoredDevice): Promise<void> {
    const store = await this.loadStore();
    store.autoStart = true;
    store.devices ??= {};
    store.devices[key] = {
      deviceId: device.deviceId,
      gatewayUrl: device.gatewayUrl,
      userId: device.userId,
      workspaceRoot: device.workspaceRoot,
      ...(safeStorage.isEncryptionAvailable()
        ? {
            encryptedToken: safeStorage
              .encryptString(device.token ?? "")
              .toString("base64"),
          }
        : {}),
    };

    await this.writeStore(store);
  }

  private async writeStore(store: StoreFile): Promise<void> {
    await mkdir(path.dirname(this.storePath), { recursive: true });
    await writeFile(this.storePath, JSON.stringify(store, null, 2), "utf8");
    this.store = store;
    this.setStatus({ autoStart: store.autoStart === true });
  }

  private async stopProcess(): Promise<void> {
    const child = this.daemonProcess;
    if (child === null) {
      return;
    }

    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        killProcessTree(child);
        resolve();
      }, 3_000);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
      killProcessTree(child);
    });
    this.daemonProcess = null;
  }

  private appendLog(value: string): void {
    const lines = value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    if (lines.length === 0) {
      return;
    }

    this.logs = [...this.logs, ...lines].slice(-maxLogLines);
    this.setStatus({});
  }

  private setStatus(patch: Partial<DesktopDaemonStatus>): void {
    this.status = {
      ...this.status,
      ...patch,
      logs: [...this.logs],
    };
    this.options.getMainWindow()?.webContents.send(
      "tavro:daemon:status",
      this.getStatus(),
    );
  }
}
