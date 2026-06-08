export {};

declare global {
  interface Window {
    tavroDesktop?: Readonly<{
      isDesktop: true;
      mode: string;
      platform: NodeJS.Platform;
      startGitHubLogin: (input: {
        redirectPath: string;
        startUrl: string;
        webOrigin: string;
      }) => Promise<void>;
      updates?: Readonly<{
        check: () => Promise<{
          checkedAt: string;
          currentVersion: string;
          latestVersion?: string;
          releaseName?: string;
          releaseUrl?: string;
          updateAvailable: boolean;
        }>;
        onUpdateAvailable: (
          listener: (info: {
            checkedAt: string;
            currentVersion: string;
            latestVersion?: string;
            releaseName?: string;
            releaseUrl?: string;
            updateAvailable: boolean;
          }) => void,
        ) => () => void;
        openRelease: (releaseUrl: string) => Promise<void>;
      }>;
      version: string;
    }>;
  }
}
