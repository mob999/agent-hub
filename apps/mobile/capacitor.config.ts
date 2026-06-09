import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'ai.tavro.mobile',
  appName: 'Tavro AI',
  webDir: '../web/dist',
  server: {
    // Uncomment for live reload during development:
    // url: 'http://10.0.2.2:5173',
    // cleartext: true,
    androidScheme: 'http',
    // Allow Capacitor to load API URLs inside the WebView so the
    // OAuth login flow (which navigates to the API to set the session
    // cookie) stays in-app instead of opening the system browser.
    allowNavigation: ['10.0.2.2', 'localhost'],
  },
  android: {
    allowMixedContent: true,
  },
  plugins: {
    CapacitorHttp: {
      enabled: false,
    },
  },
}

export default config
