import { app, BrowserWindow, Menu, shell } from "electron";
import path from "node:path";
import pkg from "../package.json";

const productionWebUrl = "https://tavro-ai.vercel.app";
const localWebUrl = "http://localhost:5173";
const productionApiOrigin = "https://tavro-api-production.up.railway.app";
const githubOrigin = "https://github.com";

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
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    githubOrigin,
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

async function openExternal(url: string): Promise<void> {
  if (/^https?:\/\//i.test(url)) {
    await shell.openExternal(url);
  }
}

function createMainWindow(): BrowserWindow {
  const webUrl = resolveWebUrl();
  const origins = allowedNavigationOrigins(webUrl);
  const mainWindow = new BrowserWindow({
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

  void mainWindow.loadURL(webUrl);
  return mainWindow;
}

process.env.TAVRO_DESKTOP_VERSION = pkg.version;
process.env.TAVRO_DESKTOP_MODE = app.isPackaged ? "production" : "development";

app.setName("Tavro AI");
Menu.setApplicationMenu(null);

app.whenReady().then(() => {
  createMainWindow();

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
