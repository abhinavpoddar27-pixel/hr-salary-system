// P2-01 test harness only — NOT part of the app build (the app builds from frontend/index.html).
// Built by backend/scripts/ui-dialog-busy-harness-check.py into a scratch directory.
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({ root: __dirname, plugins: [react()], logLevel: 'warn' })
