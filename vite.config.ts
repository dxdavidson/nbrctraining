/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icons.svg', 'ergometer.js'],
      manifest: {
        name: 'NBRC Training',
        short_name: 'NBRC Training',
        description: 'Browse training plans and send workouts to a Concept2 PM5.',
        start_url: '/',
        display: 'standalone',
        background_color: '#0d0d0d',
        theme_color: '#0d0d0d',
        icons: [
          {
            src: '/favicon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any',
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
