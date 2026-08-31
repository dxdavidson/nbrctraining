/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

// Netlify sets COMMIT_REF automatically; fall back to git for local dev builds.
function getCommitHash(): string {
  if (process.env.COMMIT_REF) return process.env.COMMIT_REF.slice(0, 7)
  try {
    return execSync('git rev-parse --short HEAD').toString().trim()
  } catch {
    return 'unknown'
  }
}

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'))

// Unset (Netlify) builds at root; set BASE_PATH=/training/ for the nbrowingclub.com sub-path deploy.
const BASE_PATH = process.env.BASE_PATH ?? '/'

// https://vite.dev/config/
export default defineConfig({
  base: BASE_PATH,
  define: {
    __APP_VERSION__: JSON.stringify(version),
    __COMMIT_HASH__: JSON.stringify(getCommitHash()),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['NBRC_Ergo_32.png', 'NBRC_Ergo_180.png', 'NBRC_Ergo_192.png', 'NBRC_Ergo_512.png', 'ergometer.js'],
      manifest: {
        name: 'NBRC Training',
        short_name: 'NBRC Training',
        description: 'Browse training plans and send workouts to a Concept2 PM5.',
        start_url: BASE_PATH,
        scope: BASE_PATH,
        display: 'standalone',
        background_color: '#0d0d0d',
        theme_color: '#0d0d0d',
        icons: [
          {
            src: `${BASE_PATH}NBRC_Ergo_192.png`,
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: `${BASE_PATH}NBRC_Ergo_512.png`,
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        // Cache read-only plan data so a previously viewed workout is available offline.
        runtimeCaching: [
          {
            urlPattern: ({ url }) => /\/api\/(plans|blocks|workouts|intervals)/.test(url.pathname),
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'nbrctraining-api-cache',
              expiration: {
                maxEntries: 200,
                maxAgeSeconds: 60 * 60 * 24 * 7, // 1 week
              },
            },
          },
        ],
      },
    }),
  ],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/setupTests.ts'],
  },
})
