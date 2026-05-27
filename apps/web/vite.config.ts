import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
const isWsl = Boolean(process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP)
const forcePolling = process.env.VITE_FORCE_POLLING
const usePolling =
  forcePolling === '1' || forcePolling === 'true'
    ? true
    : forcePolling === '0' || forcePolling === 'false'
      ? false
      : isWsl

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    watch: {
      usePolling,
      interval: usePolling ? 200 : undefined,
    },
  },
})
