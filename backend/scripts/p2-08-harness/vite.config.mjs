// P2-08 — standalone harness for frontend/src/hooks/useDraft.js (no app route is added).
// Built by backend/scripts/session-timeout-check.py:
//   HARNESS_OUT=/tmp/x frontend/node_modules/.bin/vite build --config backend/scripts/p2-08-harness/vite.config.mjs
import path from 'path'
import os from 'os'
import { fileURLToPath } from 'url'

const here = path.dirname(fileURLToPath(import.meta.url))
const fe = path.resolve(here, '../../../frontend')

export default {
  root: here,
  logLevel: 'warn',
  resolve: {
    alias: {
      react: path.join(fe, 'node_modules/react'),
      'react-dom': path.join(fe, 'node_modules/react-dom'),
    },
  },
  build: {
    outDir: process.env.HARNESS_OUT || path.join(os.tmpdir(), 'p2-08-harness-dist'),
    emptyOutDir: true,
    minify: false,
    sourcemap: false,
  },
}
