/**
 * Ambient type declarations for Capacitor runtime bridge accessed via
 * window.Capacitor.Plugins — no ES module imports needed, so
 * @capacitor/core won't patch window.fetch.
 */

interface CapacitorBridge {
  isNativePlatform: boolean;
  getPlatform(): 'android' | 'ios' | 'web';
  Plugins?: {
    App?: {
      addListener(
        event: 'appUrlOpen',
        listener: (data: { url: string }) => void,
      ): Promise<{ remove: () => void }>;
    };
    Browser?: {
      open(options: { url: string }): Promise<void>;
      close(): Promise<void>;
    };
  };
}

declare global {
  interface Window {
    Capacitor?: CapacitorBridge;
  }
}

export {};
