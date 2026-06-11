import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, repositoryRoot, '')
  const apiTarget = env.VITE_AGENTHUB_API_URL ?? 'http://localhost:3000'

  return {
    envDir: repositoryRoot,
    plugins: [react()],
    server: {
      port: 5174,
      proxy: {
        '/admin': {
          target: apiTarget,
          changeOrigin: true,
        },
        '/auth': {
          target: apiTarget,
          changeOrigin: true,
        },
      },
    },
  }
})
