import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

// P8-06: the version shown in the app comes from the build, never a hard-coded string.
// Commit: same env chain as backend /api/version (Railway sets RAILWAY_GIT_COMMIT_SHA at build time),
// then the local git checkout, else 'dev'.
function buildSha() {
  const env = process.env.RAILWAY_GIT_COMMIT_SHA || process.env.SOURCE_COMMIT || process.env.GIT_COMMIT
  if (env) return env.slice(0, 7)
  try { return execSync('git rev-parse --short=7 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || 'dev' }
  catch { return 'dev' }
}
const pkgVersion = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkgVersion),
    __BUILD_SHA__: JSON.stringify(buildSha()),
  },
  build: {
    sourcemap: false,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true
      }
    }
  }
})
