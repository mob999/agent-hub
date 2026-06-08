export {};

declare global {
  interface Window {
    tavroDesktop?: Readonly<{
      isDesktop: true;
      mode: string;
      platform: string;
      startGitHubLogin?: (input: {
        redirectPath: string;
        startUrl: string;
        webOrigin: string;
      }) => Promise<void>;
      version: string;
    }>;
  }
}
