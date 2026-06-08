import { contextBridge } from "electron";
import pkg from "../package.json";

const desktopApi = Object.freeze({
  isDesktop: true,
  mode: process.env.TAVRO_DESKTOP_MODE ?? "development",
  platform: process.platform,
  version: process.env.TAVRO_DESKTOP_VERSION ?? pkg.version,
});

contextBridge.exposeInMainWorld("tavroDesktop", desktopApi);
