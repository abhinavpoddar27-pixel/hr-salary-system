// node build-harness.mjs <outDir> [essPath]  — bundles people-picker.jsx with the
// frontend's esbuild. essPath overrides EmployeeSearchSelect (for --base runs).
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..', '..', '..')
const fe = path.join(root, 'frontend')
const require = createRequire(path.join(fe, 'package.json'))
const esbuild = require('esbuild')
const out = path.resolve(process.argv[2])
const ess = path.resolve(process.argv[3] || path.join(fe, 'src/components/shared/EmployeeSearchSelect.jsx'))
fs.mkdirSync(out, { recursive: true })
await esbuild.build({
  entryPoints: [path.join(here, 'people-picker.jsx')],
  bundle: true, outfile: path.join(out, 'app.js'), format: 'iife', jsx: 'automatic',
  loader: { '.js': 'jsx' }, nodePaths: [path.join(fe, 'node_modules')],
  alias: { '@picker': path.join(fe, 'src/components/bulk/PeoplePicker.jsx'), '@ess': ess },
  define: { 'process.env.NODE_ENV': '"development"' }, logLevel: 'warning',
})
fs.writeFileSync(path.join(out, 'index.html'),
  '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>P2-07 harness</title></head><body><div id="root"></div><script src="app.js"></script></body></html>')
console.log('built', out)
