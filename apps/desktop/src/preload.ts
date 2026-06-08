import { contextBridge, ipcRenderer } from "electron";
import pkg from "../package.json";

const desktopApi = Object.freeze({
  daemon: {
    ensureAutoStart: () =>
      ipcRenderer.invoke("tavro:daemon:ensure-auto-start") as Promise<unknown>,
    getStatus: () =>
      ipcRenderer.invoke("tavro:daemon:get-status") as Promise<unknown>,
    onStatusChange: (listener: (status: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, status: unknown) => {
        listener(status);
      };
      ipcRenderer.on("tavro:daemon:status", handler);

      return () => {
        ipcRenderer.off("tavro:daemon:status", handler);
      };
    },
    restart: () =>
      ipcRenderer.invoke("tavro:daemon:restart") as Promise<unknown>,
    start: () =>
      ipcRenderer.invoke("tavro:daemon:start") as Promise<unknown>,
  },
  isDesktop: true,
  mode: process.env.TAVRO_DESKTOP_MODE ?? "development",
  platform: process.platform,
  startGitHubLogin: (input: {
    redirectPath: string;
    startUrl: string;
    webOrigin: string;
  }) => ipcRenderer.invoke("tavro:auth:github:start", input) as Promise<void>,
  updates: {
    check: () =>
      ipcRenderer.invoke("tavro:updates:check") as Promise<unknown>,
  },
  version: process.env.TAVRO_DESKTOP_VERSION ?? pkg.version,
});

contextBridge.exposeInMainWorld("tavroDesktop", desktopApi);
