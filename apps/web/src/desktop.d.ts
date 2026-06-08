export {};

declare global {
  type TavroDesktopDaemonState =
    | "idle"
    | "checking"
    | "missing_runtime"
    | "starting"
    | "running"
    | "stopped"
    | "error";

  interface TavroDesktopDaemonStatus {
    autoStart: boolean;
    deviceId?: string;
    error?: string;
    logs: string[];
    nodeInstallUrl?: string;
    packageName: string;
    state: TavroDesktopDaemonState;
    workspaceRoot: string;
  }

  interface TavroDesktopUpdateInfo {
    checkedAt: string;
    currentVersion: string;
    latestVersion?: string;
    releaseName?: string;
    releaseUrl?: string;
    updateAvailable: boolean;
  }

  interface Window {
    tavroDesktop?: Readonly<{
      daemon?: Readonly<{
        ensureAutoStart: () => Promise<TavroDesktopDaemonStatus>;
        getStatus: () => Promise<TavroDesktopDaemonStatus>;
        onStatusChange: (
          listener: (status: TavroDesktopDaemonStatus) => void,
        ) => () => void;
        restart: () => Promise<TavroDesktopDaemonStatus>;
        start: () => Promise<TavroDesktopDaemonStatus>;
      }>;
      isDesktop: true;
      mode: string;
      platform: string;
      startGitHubLogin?: (input: {
        redirectPath: string;
        startUrl: string;
        webOrigin: string;
      }) => Promise<void>;
      updates?: Readonly<{
        check: () => Promise<TavroDesktopUpdateInfo>;
      }>;
      version: string;
    }>;
  }
}
