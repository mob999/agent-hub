export {};

declare global {
  interface Window {
    tavroDesktop?: Readonly<{
      isDesktop: true;
      mode: string;
      platform: NodeJS.Platform;
      version: string;
    }>;
  }
}
