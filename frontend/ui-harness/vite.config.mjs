// Test-only build of the shared UI components (P2-ED, planner ruling Q4b).
// Built by backend/scripts/ui-components-check.py into a scratch directory; it is
// NOT part of the app bundle (frontend/vite.config.js never sees this folder).
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'url'
import path from 'path'

const here = path.dirname(fileURLToPath(import.meta.url))
export default defineConfig({
  root: here,
  base: './',
  plugins: [react()],
  css: { postcss: here },
  build: { sourcemap: false, emptyOutDir: true },
})
