/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  build: {
    target: 'es2022',
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'supabase-vendor': ['@supabase/supabase-js'],
          // Animation is used on every screen, so it gets its own long-lived
          // chunk rather than being duplicated across the lazy route bundles.
          'motion-vendor': ['motion/react']
        }
      }
    }
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      workbox: {
        // Single-page client: unknown paths resolve to the app shell.
        navigateFallback: 'index.html',
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        cleanupOutdatedCaches: true
      },
      manifest: {
        id: '/',
        name: 'Presently Campus — Class Attendance',
        short_name: 'Campus',
        description: 'QR attendance for classes, with every subject’s standing for teachers and students.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#f2f2f0',
        theme_color: '#f2f2f0',
        categories: ['education', 'productivity'],
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }
        ]
      }
    })
  ],
  test: {
    // Pure logic runs in Node; anything that renders opts into jsdom with a
    // `@vitest-environment` comment, which keeps the fast tests fast.
    environment: 'node',
    // The Edge Functions' shared logic is plain TypeScript and is tested here
    // too, so `npm run check` covers the server's rules as well as the app's.
    include: ['src/**/*.test.{ts,tsx}', 'supabase/functions/_shared/**/*.test.ts'],
    setupFiles: ['src/test/setup.ts'],
    // Generous, because the render suites pay for on-demand chunk transforms.
    testTimeout: 30_000
  }
})
