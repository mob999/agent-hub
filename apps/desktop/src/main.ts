import { app, BrowserWindow, ipcMain, Menu, shell } from "electron";
import path from "node:path";
import pkg from "../package.json";

const desktopProtocol = "tavro";
const productionWebUrl = "https://tavro-ai.vercel.app";
const localWebUrl = "http://localhost:5173";
const productionApiOrigin = "https://tavro-api-production.up.railway.app";
const localApiOrigin = "http://localhost:3000";
const localApiOriginByIp = "http://127.0.0.1:3000";
const githubOrigin = "https://github.com";

let mainWindow: BrowserWindow | null = null;
let pendingDesktopAuthApiOrigin: string | null = null;

function normalizeUrl(value: string): string {
  return new URL(value).toString();
}

function resolveWebUrl(): string {
  if (process.env.TAVRO_DESKTOP_WEB_URL) {
    return normalizeUrl(process.env.TAVRO_DESKTOP_WEB_URL);
  }

  return app.isPackaged ? productionWebUrl : localWebUrl;
}

function allowedNavigationOrigins(webUrl: string): Set<string> {
  return new Set([
    new URL(webUrl).origin,
    new URL(productionWebUrl).origin,
    new URL(localWebUrl).origin,
    new URL(productionApiOrigin).origin,
    localApiOrigin,
    localApiOriginByIp,
    githubOrigin,
  ]);
}

function allowedApiOrigins(): Set<string> {
  return new Set([
    new URL(productionApiOrigin).origin,
    new URL(localApiOrigin).origin,
    new URL(localApiOriginByIp).origin,
  ]);
}

function isAllowedNavigationUrl(url: string, origins: Set<string>): boolean {
  try {
    const parsed = new URL(url);
    return origins.has(parsed.origin);
  } catch {
    return false;
  }
}

function resolveAppIconPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "icon.png");
  }

  return path.join(__dirname, "..", "resources", "icons", "256x256.png");
}

function resolveFallbackApiOrigin(): string {
  return app.isPackaged ? productionApiOrigin : localApiOrigin;
}

async function openExternal(url: string): Promise<void> {
  if (/^https?:\/\//i.test(url)) {
    await shell.openExternal(url);
  }
}

function isDesktopAuthStartUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      allowedApiOrigins().has(url.origin) &&
      url.pathname === "/auth/desktop/github/start"
    );
  } catch {
    return false;
  }
}

function registerDesktopProtocol(): void {
  if (process.defaultApp) {
    const appEntry = process.argv[1];
    if (appEntry) {
      app.setAsDefaultProtocolClient(desktopProtocol, process.execPath, [
        path.resolve(appEntry),
      ]);
      return;
    }
  }

  app.setAsDefaultProtocolClient(desktopProtocol);
}

function focusMainWindow(): void {
  if (!mainWindow) {
    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.focus();
}

function webLoginUrlForError(error: string): string {
  const url = new URL("/login", resolveWebUrl());
  url.searchParams.set("error", error);
  return url.toString();
}

function handleDesktopAuthCallback(rawUrl: string): void {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return;
  }

  if (
    url.protocol !== `${desktopProtocol}:` ||
    url.hostname !== "auth" ||
    url.pathname !== "/callback"
  ) {
    return;
  }

  const error = url.searchParams.get("error");
  const code = url.searchParams.get("code");
  if (error) {
    void mainWindow?.loadURL(webLoginUrlForError(error));
    focusMainWindow();
    return;
  }

  if (!code) {
    void mainWindow?.loadURL(webLoginUrlForError("desktop_auth_expired"));
    focusMainWindow();
    return;
  }

  const completeUrl = new URL(
    "/auth/desktop/complete",
    pendingDesktopAuthApiOrigin ?? resolveFallbackApiOrigin(),
  );
  completeUrl.searchParams.set("code", code);
  pendingDesktopAuthApiOrigin = null;
  void mainWindow?.loadURL(completeUrl.toString());
  focusMainWindow();
}

function findDesktopCallbackUrl(args: string[]): string | null {
  return args.find((arg) => arg.startsWith(`${desktopProtocol}://`)) ?? null;
}

function registerAuthIpc(): void {
  ipcMain.handle("tavro:auth:github:start", async (_event, input: unknown) => {
    const payload = input as {
      redirectPath?: unknown;
      startUrl?: unknown;
      webOrigin?: unknown;
    };

    if (
      typeof payload.startUrl !== "string" ||
      typeof payload.redirectPath !== "string" ||
      typeof payload.webOrigin !== "string" ||
      !isDesktopAuthStartUrl(payload.startUrl)
    ) {
      throw new Error("Invalid desktop login request.");
    }

    const startUrl = new URL(payload.startUrl);
    pendingDesktopAuthApiOrigin = startUrl.origin;
    const response = await fetch(startUrl.toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        redirectPath: payload.redirectPath,
        webOrigin: payload.webOrigin,
      }),
    });

    if (!response.ok) {
      pendingDesktopAuthApiOrigin = null;
      throw new Error("Desktop login could not be started.");
    }

    const body = await response.json() as { authorizeUrl?: unknown };
    if (typeof body.authorizeUrl !== "string") {
      pendingDesktopAuthApiOrigin = null;
      throw new Error("Desktop login response was invalid.");
    }

    await openExternal(body.authorizeUrl);
  });
}

function createMainWindow(): BrowserWindow {
  const webUrl = resolveWebUrl();
  const origins = allowedNavigationOrigins(webUrl);
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    title: "Tavro AI",
    icon: resolveAppIconPath(),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.js"),
      sandbox: false,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void openExternal(url);
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (isAllowedNavigationUrl(url, origins)) {
      return;
    }

    event.preventDefault();
    void openExternal(url);
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  void mainWindow.loadURL(webUrl);
  return mainWindow;
}

process.env.TAVRO_DESKTOP_VERSION = pkg.version;
process.env.TAVRO_DESKTOP_MODE = app.isPackaged ? "production" : "development";

app.setName("Tavro AI");
Menu.setApplicationMenu(null);
registerDesktopProtocol();
registerAuthIpc();

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    const callbackUrl = findDesktopCallbackUrl(argv);
    if (callbackUrl) {
      handleDesktopAuthCallback(callbackUrl);
    }
    focusMainWindow();
  });

  app.on("open-url", (event, url) => {
    event.preventDefault();
    handleDesktopAuthCallback(url);
  });

  app.whenReady().then(() => {
    createMainWindow();
    const callbackUrl = findDesktopCallbackUrl(process.argv);
    if (callbackUrl) {
      handleDesktopAuthCallback(callbackUrl);
    }

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
      }
    });
  }).catch((error: unknown) => {
    console.error("Failed to start Tavro desktop client.", error);
    app.exit(1);
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });
}
