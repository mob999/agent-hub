import { contextBridge, ipcRenderer } from "electron";
import pkg from "../package.json";

const desktopApi = Object.freeze({
  isDesktop: true,
  mode: process.env.TAVRO_DESKTOP_MODE ?? "development",
  platform: process.platform,
  startGitHubLogin: (input: {
    redirectPath: string;
    startUrl: string;
    webOrigin: string;
  }) => ipcRenderer.invoke("tavro:auth:github:start", input) as Promise<void>,
  version: process.env.TAVRO_DESKTOP_VERSION ?? pkg.version,
});

contextBridge.exposeInMainWorld("tavroDesktop", desktopApi);
